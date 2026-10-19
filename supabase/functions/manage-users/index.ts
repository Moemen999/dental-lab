// =============================================================================
// Supabase Edge Function: manage-users
// Privileged administrative operations for Owner role
// =============================================================================
// Standard Deno runtime for Supabase Edge Functions

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** 24 random bytes, base64url: never stored, logged or returned. */
function generateRandomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface RequestPayload {
  action: "create-user" | "update-role" | "deactivate-user" | "reset-password" | "get-outstanding-work";
  userId?: string;
  email?: string;
  fullName?: string;
  role?: "owner" | "representative" | "receptionist" | "technician";
  phone?: string;
  reassignToUserId?: string;
  reason?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client with service role for admin tasks
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Client acting AS the caller (anon key + caller JWT). Database functions that
    // check auth.uid() (e.g. reassign_and_deactivate_technician) must be called
    // through this client so the real Owner is the actor, never NULL.
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user: callerUser }, error: userError } = await userClient.auth.getUser();
    if (userError || !callerUser) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication credentials" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Authorize caller - must be active Owner
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, status, full_name")
      .eq("id", callerUser.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: "Caller profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (callerProfile.role !== "owner" || callerProfile.status !== "active") {
      return new Response(
        JSON.stringify({ error: "Forbidden: Only active laboratory owners may perform user administration." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: RequestPayload = await req.json();
    const { action } = payload;

    // 3. Dispatch actions
    switch (action) {
      case "get-outstanding-work": {
        if (!payload.userId) {
          return new Response(
            JSON.stringify({ error: "userId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: work, error: workErr } = await userClient.rpc(
          "get_employee_outstanding_work",
          { p_user_id: payload.userId }
        );

        if (workErr) throw workErr;

        return new Response(
          JSON.stringify({ data: work }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "create-user": {
        const { email, fullName, role, phone } = payload;
        if (!email || !fullName || !role) {
          return new Response(
            JSON.stringify({ error: "email, fullName, and role are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Create auth user with a random password nobody knows; the employee
        // sets their own through the password-setup email sent below.
        const { data: newAuth, error: createAuthError } = await adminClient.auth.admin.createUser({
          email,
          password: generateRandomPassword(),
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (createAuthError) throw createAuthError;

        // Upsert profile
        const { data: newProfile, error: profileInsertError } = await adminClient
          .from("profiles")
          .upsert({
            id: newAuth.user.id,
            email,
            full_name: fullName,
            role,
            status: "active",
            phone: phone || null,
          })
          .select()
          .single();

        if (profileInsertError) throw profileInsertError;

        const { error: setupEmailError } = await adminClient.auth.resetPasswordForEmail(email);

        // Audit log
        await adminClient.from("audit_logs").insert({
          action: "user_created",
          actor_id: callerUser.id,
          target_id: newAuth.user.id,
          target_type: "user",
          details: { email, full_name: fullName, role },
        });

        return new Response(
          JSON.stringify({
            success: true,
            user: newProfile,
            password_setup_email_sent: !setupEmailError,
          }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "update-role": {
        const { userId, role } = payload;
        if (!userId || !role) {
          return new Response(
            JSON.stringify({ error: "userId and role are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Fetch target
        const { data: targetProfile, error: getTargetError } = await adminClient
          .from("profiles")
          .select("role, status, email")
          .eq("id", userId)
          .single();

        if (getTargetError || !targetProfile) {
          return new Response(
            JSON.stringify({ error: "Target user not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // If target is currently an owner and demoting, verify other active owners exist
        if (targetProfile.role === "owner" && role !== "owner") {
          const { count, error: countErr } = await adminClient
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .eq("role", "owner")
            .eq("status", "active")
            .neq("id", userId);

          if (countErr) throw countErr;
          if (!count || count < 1) {
            return new Response(
              JSON.stringify({ error: "Cannot demote the last active Owner account." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        const { data: updatedProfile, error: updateError } = await adminClient
          .from("profiles")
          .update({ role, updated_at: new Date().toISOString() })
          .eq("id", userId)
          .select()
          .single();

        if (updateError) throw updateError;

        // Update auth user metadata
        await adminClient.auth.admin.updateUserById(userId, {
          app_metadata: { role },
        });

        // Audit log
        await adminClient.from("audit_logs").insert({
          action: "user_role_changed",
          actor_id: callerUser.id,
          target_id: userId,
          target_type: "user",
          details: { previous_role: targetProfile.role, new_role: role },
        });

        return new Response(
          JSON.stringify({ success: true, user: updatedProfile }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "deactivate-user": {
        const { userId, reassignToUserId, reason } = payload;
        if (!userId) {
          return new Response(
            JSON.stringify({ error: "userId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (userId === callerUser.id) {
          return new Response(
            JSON.stringify({ error: "You cannot deactivate your own account." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check if target is an owner
        const { data: targetProfile, error: getTargetError } = await adminClient
          .from("profiles")
          .select("role, status, email")
          .eq("id", userId)
          .single();

        if (getTargetError || !targetProfile) {
          return new Response(
            JSON.stringify({ error: "Target user not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        if (targetProfile.role === "owner") {
          const { count } = await adminClient
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .eq("role", "owner")
            .eq("status", "active")
            .neq("id", userId);

          if (!count || count < 1) {
            return new Response(
              JSON.stringify({ error: "Cannot deactivate the last active Owner account." }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }

        // If target is technician, invoke safe reassignment procedure
        if (targetProfile.role === "technician") {
          const { data: reassignResult, error: reassignError } = await userClient.rpc(
            "reassign_and_deactivate_technician",
            {
              p_technician_id: userId,
              p_reassign_to_id: reassignToUserId || null,
              p_reason: reason || "Owner deactivation",
            }
          );

          if (reassignError) throw reassignError;

          // Invalidate user sessions server-side
          try {
            await adminClient.auth.admin.signOut(userId, "global");
          } catch (_) {
            // non-fatal if session signout fails or user was already offline
          }

          return new Response(
            JSON.stringify({ success: true, result: reassignResult }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Otherwise deactivate profile directly
        const { error: deactError } = await adminClient
          .from("profiles")
          .update({
            status: "inactive",
            deactivated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (deactError) throw deactError;

        // Invalidate sessions
        try {
          await adminClient.auth.admin.signOut(userId, "global");
        } catch (_) {}

        // Audit log
        await adminClient.from("audit_logs").insert({
          action: "user_deactivated",
          actor_id: callerUser.id,
          target_id: userId,
          target_type: "user",
          details: { reason: reason || "Account deactivated by Owner" },
        });

        return new Response(
          JSON.stringify({ success: true, message: "User deactivated successfully" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "reset-password": {
        const { userId, email } = payload;
        if (!userId && !email) {
          return new Response(
            JSON.stringify({ error: "userId or email is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let targetEmail = email;
        if (!targetEmail && userId) {
          const { data: p } = await adminClient.from("profiles").select("email").eq("id", userId).single();
          targetEmail = p?.email;
        }

        if (!targetEmail) {
          return new Response(
            JSON.stringify({ error: "Target email not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: resetError } = await adminClient.auth.resetPasswordForEmail(targetEmail);
        if (resetError) throw resetError;

        // Audit log
        await adminClient.from("audit_logs").insert({
          action: "user_password_reset",
          actor_id: callerUser.id,
          target_id: userId || null,
          target_type: "user",
          details: { email: targetEmail },
        });

        return new Response(
          JSON.stringify({ success: true, message: "Password reset instructions dispatched." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unsupported action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
