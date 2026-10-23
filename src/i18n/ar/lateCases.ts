export const lateCases = {
  title: 'المتأخرات',
  subtitle: 'حالات فات موعد تسليمها أو موعد تسليمها اليوم (بتوقيت القاهرة)',
  sections: {
    late: 'متأخرة ({count})',
    today: 'تسليم اليوم ({count})',
  },
  empty: {
    late: 'لا توجد حالات متأخرة',
    today: 'لا توجد حالات موعد تسليمها اليوم',
  },
  columns: {
    caseNumber: 'رقم الحالة',
    patient: 'المريض',
    doctor: 'الطبيب',
    technician: 'الفني',
    dueDate: 'موعد التسليم',
    status: 'الحالة',
    actions: 'إجراءات',
  },
  unassigned: 'غير معيّن',
  noDoctor: 'غير محدد',
  viewCase: 'عرض الحالة',
  whatsapp: 'واتساب',
  whatsappAria: 'فتح واتساب لمراسلة الطبيب بخصوص الحالة {caseNumber} (لن يُرسل شيء تلقائيًا)',
  whatsappHint: 'زر واتساب يفتح رسالة جاهزة للطبيب، ولا يُرسل شيء إلا بعد أن تضغط إرسال بنفسك.',
  phoneWarning: {
    missing: 'لا يوجد رقم موبايل مسجل للطبيب — لا يمكن إنشاء رابط واتساب.',
    landline: 'رقم الطبيب المسجل رقم أرضي، وواتساب يتطلب رقم موبايل مصري (010 أو 011 أو 012 أو 015) — لا يمكن إنشاء رابط واتساب.',
    invalid: 'رقم الطبيب غير صحيح، والمطلوب رقم موبايل مصري (010 أو 011 أو 012 أو 015) — لا يمكن إنشاء رابط واتساب.',
  },
  card: {
    title: 'المتأخرات',
    summary: 'متأخرة: {late} — تسليم اليوم: {today}',
    open: 'عرض المتأخرات',
  },
  message: {
    greeting: 'السلام عليكم د. {doctor}',
    // The stored name already starts with a title (د. / دكتور / دكتورة): used as written.
    greetingTitled: 'السلام عليكم {doctor}',
    greetingNoName: 'السلام عليكم دكتور',
    greetingTitleFemale: 'السلام عليكم دكتورة',
    // The doctor knows the case by the patient's name, not the lab's case number (owner decision).
    // {caseRef} = caseWithPatient, or only the case number when the name is empty.
    caseWithPatient: '{caseNumber} (اسم المريض: {patientName})',
    late: '{greeting}\nمعكم معمل دولفين لتقويم الأسنان.\nبخصوص الحالة رقم {caseRef}، كان موعد تسليمها {date}.\nنعتذر عن التأخير، وسنتواصل معكم لتأكيد موعد التسليم الجديد.',
    today: '{greeting}\nمعكم معمل دولفين لتقويم الأسنان.\nبخصوص الحالة رقم {caseRef}، موعد تسليمها اليوم {date}.\nسنتواصل معكم لتأكيد وقت التسليم.',
  },
};
