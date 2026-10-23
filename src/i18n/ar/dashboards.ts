export const dashboards = {
  owner: {
    title: 'لوحة التحكم',
    subtitle: 'نظرة عامة على عمليات المعمل',
    stats: {
      total: 'إجمالي الحالات',
      inProgress: 'قيد التنفيذ',
      overdue: 'متأخرة',
      delivered: 'تم تسليمها',
      activeStaff: 'موظفون نشطون',
      awaitingPickup: 'عند المندوب أو بانتظاره',
    },
    pipeline: 'مسار الحالات',
    recentCases: 'أحدث الحالات',
    noCases: 'لا توجد حالات بعد',
  },
  reception: {
    title: 'مكتب الاستقبال',
    subtitle: 'تسجيل الحالات الواردة، وتعيين الفنيين، وتجهيز التسليم',
    registerCase: 'تسجيل حالة',
    batches: 'الدفعات',
    metrics: {
      awaitingAssignment: 'بانتظار تعيين فني',
      awaitingReceipt: 'من الفنيين (بانتظار الاستلام)',
      readyForPickup: 'جاهزة للتجهيز للمندوب',
    },
    sections: {
      awaitingAssignment: 'حالات بانتظار تعيين فني ({count})',
      awaitingReceipt: 'أنهاها الفنيون — بانتظار استلام الاستقبال ({count})',
      inReception: 'في الاستقبال — جاهزة للتجهيز للمندوب ({count})',
    },
    empty: {
      awaitingAssignment: 'لا توجد حالات بانتظار تعيين فني.',
      awaitingReceipt: 'لا توجد حالات بانتظار الاستلام في الاستقبال.',
      inReception: 'لا توجد حالات في الاستقبال حاليًا.',
    },
    columns: {
      targetDue: 'موعد التسليم',
      clinicDestination: 'العيادة المرسل إليها',
    },
    assignTech: 'تعيين فني',
    receive: 'استلام في الاستقبال',
    stage: 'تجهيز للمندوب',
    assignDialog: {
      title: 'تعيين فني',
      body: 'تعيين الحالة {caseNumber} إلى فني:',
      selectLabel: 'اختر الفني',
      submit: 'تعيين',
    },
    notes: {
      received: 'استلمها الاستقبال من الفني',
      staged: 'جهّزها الاستقبال لاستلام المندوب',
    },
    toasts: {
      assigned: 'تم تعيين الحالة {caseNumber}',
      received: 'تم استلام الحالة {caseNumber} في الاستقبال',
      staged: 'تم تجهيز الحالة {caseNumber} لاستلام المندوب',
    },
  },
  technician: {
    welcome: 'أهلًا، {name}',
    subtitle: 'طاولة العمل — الحالات المعيّنة لك للتصنيع',
    metrics: {
      inProgress: 'قيد التنفيذ',
      readyToStart: 'جاهزة للبدء',
      onHoldRework: 'معلّقة / إعادة عمل',
      total: 'إجمالي الحالات',
    },
    queueTitle: 'قائمة العمل',
    tabs: {
      inProgress: 'قيد التنفيذ ({count})',
      assigned: 'جديدة ({count})',
      all: 'كل الحالات ({count})',
    },
    empty: {
      title: 'لا توجد حالات في هذه القائمة',
      description: 'لا توجد حالات تطابق التبويب المختار.',
    },
    columns: {
      specifications: 'المواصفات',
      targetDue: 'موعد التسليم',
    },
    startWork: 'بدء العمل',
    complete: 'إنهاء',
    putOnHold: 'تعليق',
    submitToReception: 'تسليم للاستقبال',
    dialog: {
      title: 'تحديث تقدم الحالة',
      body: 'نقل الحالة {caseNumber} إلى {status}.',
      notesLabel: 'ملاحظات الفني',
      notesPlaceholder: 'تفاصيل الخطوات المنجزة، أو سبب التعليق…',
    },
    notes: {
      started: 'بدأ الفني العمل على الحالة',
    },
    toasts: {
      started: 'بدأ العمل على الحالة {caseNumber}',
      updated: 'تم نقل الحالة إلى: {status}',
    },
  },
  representative: {
    title: 'لوحة المندوب',
    subtitle: 'استلام الحالات الجاهزة من المعمل وتسليمها إلى العيادات',
    deliveryBatches: 'دفعات التوصيل',
    metrics: {
      awaitingPickup: 'جاهزة في المعمل (بانتظار الاستلام)',
      inTransit: 'في الطريق معك',
      openBatches: 'دفعات مفتوحة',
    },
    sections: {
      inTransit: 'حالات في الطريق ({count})',
      readyForPickup: 'حالات جاهزة في المعمل للاستلام ({count})',
    },
    empty: {
      inTransit: 'لا توجد حالات معك في الطريق حاليًا.',
      readyForPickup: 'لا توجد حالات بانتظار الاستلام من المعمل.',
    },
    columns: {
      destination: 'العيادة والطبيب',
      contact: 'عنوان / هاتف العيادة',
      destinationDentist: 'الطبيب المرسل إليه',
    },
    markDelivered: 'تأكيد التسليم',
    pickUp: 'استلام من المعمل',
    dialog: {
      title: 'تأكيد التسليم للعيادة',
      body: 'تأكيد تسليم الحالة {caseNumber} إلى {clinic}.',
      theClinic: 'العيادة',
      notesLabel: 'ملاحظات التسليم (مثلًا: اسم من استلم في العيادة)',
      notesPlaceholder: 'استلمتها موظفة الاستقبال في العيادة…',
      submit: 'تأكيد التسليم',
    },
    notes: {
      pickedUp: 'استلمها المندوب {name}',
      deliveredWithNote: 'تم التسليم للعيادة: {note}',
      delivered: 'تم التسليم لطبيب العيادة',
    },
    toasts: {
      pickedUp: 'تم استلام الحالة {caseNumber} لتوصيلها للعيادة',
      delivered: 'تم تأكيد تسليم الحالة {caseNumber}',
    },
  },
};
