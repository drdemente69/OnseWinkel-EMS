// Payroll calculation engine
//
// Onse Winkel pay rules:
//   - Normal hours:        hours × wage
//   - Overtime hours:      hours × wage × 1.5
//   - Sunday & worked
//     public holiday:      hours × wage × 2          (type: 'sunday' | 'holiday' | 'holiday_worked')
//   - Paid public holiday: avgDailyHours × wage × 1  (type: 'holiday_paid' | 'public_holiday')
//   - Sick leave:          hours × wage              (hours stored = avg daily)
//   - Annual leave:        hours × wage              (hours stored = avg daily; also covers
//                                                     family responsibility + compassionate
//                                                     since the leave service maps them to
//                                                     attendance.type='annual')
//   - Unpaid leave:        no pay (type='unpaid')
//   - UIF:                 1% of gross
//
// All ZAR values are rounded to the nearest cent.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

export function calcPayslip({
  hourlyWage,
  attendance,
  commission = 0,
  bonus = 0,
  otherEarnings = 0,
  otherDeductions = 0,
  paye = 0,
  sickAvgHours = null,
  uifRate = 0.01,
  overtimeMultiplier = 1.5,
  holidayMultiplier = 2.0,
}) {
  const w = Number(hourlyWage) || 0;
  let normalHours = 0;
  let overtimeHours = 0;
  let holidayHours = 0;        // worked at the holiday multiplier (2×)
  let publicHolidayDays = 0;   // paid-off public holidays (counted once each)
  let sickHours = 0;
  let annualHours = 0;         // paid leave: annual / family / compassionate
  let unpaidHours = 0;
  let workDays = 0;
  let totalDailyHours = 0;
  let sickDays = 0;

  for (const d of attendance || []) {
    const hours = Number(d.hours) || 0;
    const ot = Number(d.overtime) || 0;
    if (d.type === 'normal') {
      normalHours += hours;
      overtimeHours += ot;
      if (hours > 0) {
        workDays++;
        totalDailyHours += hours;
      }
    } else if (
      d.type === 'sunday' ||
      d.type === 'holiday' ||
      d.type === 'holiday_worked'
    ) {
      // Worked Sundays/public holidays — paid at the holiday multiplier.
      holidayHours += hours;
    } else if (d.type === 'holiday_paid' || d.type === 'public_holiday') {
      // Paid public holiday off — counts as one "day", hours derived from avg.
      publicHolidayDays++;
    } else if (d.type === 'sick') {
      sickHours += hours;
      sickDays++;
    } else if (d.type === 'annual') {
      // Includes family-responsibility + compassionate (mapped by leave service).
      annualHours += hours;
    } else if (d.type === 'unpaid') {
      unpaidHours += hours;
    }
  }

  const avgDaily =
    sickAvgHours != null ? sickAvgHours : workDays > 0 ? totalDailyHours / workDays : 8;

  const publicHolidayHours = round4(publicHolidayDays * avgDaily);

  const normalPay = round2(normalHours * w);
  const overtimePay = round2(overtimeHours * w * overtimeMultiplier);
  const holidayPay = round2(holidayHours * w * holidayMultiplier);
  const publicHolidayPay = round2(publicHolidayHours * w);
  // Sick + Annual: both paid at the normal hourly rate against the hours
  // already stored on each attendance row (the leave system writes avgDaily
  // per leave day, so this becomes avgDaily × wage per day automatically).
  const sickPay = round2(sickHours * w);
  const annualPay = round2(annualHours * w);

  const earnings =
    normalPay +
    overtimePay +
    holidayPay +
    publicHolidayPay +
    sickPay +
    annualPay +
    Number(commission || 0) +
    Number(bonus || 0) +
    Number(otherEarnings || 0);

  const gross = round2(earnings);
  const uif = round2(gross * uifRate);
  const totalDeductions = round2(uif + Number(paye || 0) + Number(otherDeductions || 0));
  const net = round2(gross - totalDeductions);

  return {
    hours: {
      normal: round2(normalHours),
      overtime: round2(overtimeHours),
      holiday: round2(holidayHours),
      publicHoliday: round2(publicHolidayHours),
      sick: round2(sickHours),
      annual: round2(annualHours),
      leave: round2(annualHours + unpaidHours),   // kept for backwards-compat consumers
      unpaid: round2(unpaidHours),
    },
    earnings: {
      normalPay,
      overtimePay,
      holidayPay,
      publicHolidayPay,
      sickPay,
      annualPay,
      commission: round2(Number(commission || 0)),
      bonus: round2(Number(bonus || 0)),
      other: round2(Number(otherEarnings || 0)),
    },
    rates: {
      normal: round2(w),
      overtime: round2(w * overtimeMultiplier),
      holiday: round2(w * holidayMultiplier),
      publicHoliday: round2(w),
      annual: round2(w),
      sick: round2(w),
    },
    deductions: {
      uif,
      paye: round2(Number(paye || 0)),
      other: round2(Number(otherDeductions || 0)),
      total: totalDeductions,
    },
    counts: {
      publicHolidayDays,
      workDays,
      sickDays,
    },
    gross,
    uif,
    net,
    avgDaily: round2(avgDaily),
    sickDays,
    workDays,
  };
}

export function ytdForEmployee(employee, payslipsBeforeAndIncluding) {
  const acc = (payslipsBeforeAndIncluding || []).reduce(
    (a, p) => {
      a.gross += Number(p.gross) || 0;
      a.uif += Number(p.uif) || 0;
      a.normal += Number(p.normal_pay) || 0;
      a.overtime += Number(p.overtime_pay) || 0;
      a.holiday += Number(p.holiday_pay) || 0;
      a.publicHoliday += Number(p.public_holiday_pay) || 0;
      a.sick += Number(p.sick_pay) || 0;
      a.annual += Number(p.annual_pay) || 0;
      a.commission += Number(p.commission) || 0;
      a.bonus += Number(p.bonus) || 0;
      return a;
    },
    { gross: 0, uif: 0, normal: 0, overtime: 0, holiday: 0, publicHoliday: 0, sick: 0, annual: 0, commission: 0, bonus: 0 },
  );
  const initial = Number(employee.initial_ytd || 0);
  return {
    gross: round2(initial + acc.gross),
    uif: round2(initial * 0.01 + acc.uif),
    net: round2(initial + acc.gross - (initial * 0.01 + acc.uif)),
    normal: round2(initial * 0.75 + acc.normal),
    overtime: round2(initial * 0.02 + acc.overtime),
    holiday: round2(initial * 0.23 + acc.holiday),
    publicHoliday: round2(acc.publicHoliday),
    sick: round2(acc.sick),
    annual: round2(acc.annual),
    commission: round2(acc.commission),
    bonus: round2(acc.bonus),
  };
}
