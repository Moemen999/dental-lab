# Agent Skills Discovery & Usage Report

## 1. Discovery Scope & Sources
During architectural design and implementation, the development environment and available tools were inspected against project requirements:
- Anthropic official skills specification & convention guidelines
- Custom subagent definitions and local workspace tools

---

## 2. Skills & Capabilities Evaluated

| Skill / Capability | Purpose in Project | Status | Justification / Result |
| :--- | :--- | :---: | :--- |
| **`codewriter` (Custom Subagent)** | Parallelized full-stack file creation and testing | **Utilized** | Defined and leveraged to generate UI components, page layouts, queries, and tests concurrently. |
| **`automation` (Built-in Skill)** | Recurring background task scheduling | Evaluated / Skipped | Database backups and migrations are handled via version-controlled scripts (`scripts/backup.ps1`) rather than OS background crons to maintain portability across free deployment tiers. |
| **`generative_ui` (Built-in Skill)** | Inline UI rendering | Evaluated / Skipped | Production React web interface built with standard Vite, Tailwind CSS, and shadcn-style modular components. |
| **Third-Party External Skills** | Remote skill repositories | **Reviewed & Excluded** | External third-party scripts from untrusted public repositories were audited and rejected to prevent supply-chain security risks, credential exfiltration, and unsafe dependencies. |

---

## 3. Project-Specific Verification Capabilities
To guarantee the highest quality without relying on untrusted external scripts, dedicated in-repo automated verification scripts and tests were implemented:
1. **State Machine Verification**: `src/test/stateMachine.test.ts`
2. **Case Numbering & Roll-over**: `src/test/caseNumber.test.ts`
3. **Role & Permission Enforcement**: `src/test/permissions.test.ts`
4. **Handoff & Batch Integrity**: `src/test/handoffs.test.ts`
5. **Owner & Employee Security**: `src/test/employeeAdmin.test.ts`
6. **Data & Date Utilities**: `src/test/utils.test.ts`
