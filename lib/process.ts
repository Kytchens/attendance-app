/**
 * Attendance Processing Engine
 * Ported from Python attendance_pipeline.py
 */

export interface DailyRow {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  department: string;
  location: string;
  reportingManager: string;
  date: string;
  assignedShift: string;
  shiftStart: string;
  shiftEnd: string;
  timeAssignment: string;
  actualClockIn: string;
  actualClockOut: string;
  kekaStatus: string;
  attendanceStatus: string;
  lateByRaw: string;
  minutesLate: number | null;
  lateArrivalFlag: string;
  missingCheckInFlag: string;
  missingCheckOutFlag: string;
  shiftMismatchFlag: string;
  shiftMismatchDetail: string;
  regularizationNeeded: string;
  regularizationReason: string;
  regularizationFiled: string;
  regularizationType: string;
  effectiveHours: string;
  totalHours: string;
  shortDayFlag: string;
  integrityFlag: string;
}

export interface SummaryRow {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  department: string;
  location: string;
  totalDaysInPeriod: number;
  workingDays: number;
  totalDaysPresent: number;
  totalAbsences: number;
  totalWeekOffs: number;
  earnedLeaves: number;
  unpaidLeaves: number;
  totalLateArrivals: number;
  lopDays: number;
  shiftMismatches: number;
  totalRegularizationsNeeded: number;
  regularizationsFiled: number;
  employeeFaultRegularizations: string;
  shortDays: number;
  attendanceBonusEligible: string;
  bonusFailReasons: string;
}

export interface ProcessingStats {
  employees: number;
  dailyRecords: number;
  lateArrivals: number;
  lopDays: number;
  shiftMismatches: number;
  regsNeeded: number;
  bonusEligible: number;
  bonusNotEligible: number;
  shortDays: number;
  integrityFlags: number;
  totalAbsences: number;
}

export interface ProcessingResult {
  daily: DailyRow[];
  summary: SummaryRow[];
  stats: ProcessingStats;
}

// -- Helpers --

function parseTimeStr(t: unknown): number | null {
  if (t === null || t === undefined || t === "" || t === "NaN") return null;
  const s = String(t).trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  }
  return null;
}

function parseDurationStr(d: unknown): number | null {
  if (d === null || d === undefined || d === "" || d === "NaN") return null;
  const s = String(d).trim().replace(".", ":");
  const parts = s.split(":");
  if (parts.length >= 2) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  }
  return null;
}

function computeShiftDuration(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  return end > start ? end - start : (1440 - start) + end;
}

function minutesDiffCircular(a: number, b: number): number {
  let diff = b - a;
  if (diff > 720) diff -= 1440;
  else if (diff < -720) diff += 1440;
  return diff;
}

function fmtMinutes(m: number): string {
  const abs = Math.abs(m);
  if (abs < 60) return `${abs} min`;
  const h = Math.floor(abs / 60);
  const rem = abs % 60;
  return rem === 0 ? `${h} hrs` : `${h} hrs ${rem} min`;
}

function str(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function isValidDate(dateStr: string): boolean {
  return /^\d{2}-[A-Za-z]{3}-\d{4}$/.test(dateStr);
}

function formatDateKey(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = date.getDate().toString().padStart(2, "0");
  return `${d}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function classifyRegType(note: string): string {
  if (!note) return "";
  const n = note.toLowerCase();
  for (const kw of ["keka", "tech issue", "system", "gps", "location issue", "server", "app issue", "network"]) {
    if (n.includes(kw)) return "System-or-KM-Error";
  }
  return "";
}

// -- Lookup builders --

type RegLookup = Map<string, { note: string }>;
type TALookup = Map<string, string>;

function buildRegLookup(regRows: Record<string, unknown>[]): RegLookup {
  const lookup: RegLookup = new Map();
  for (const row of regRows) {
    const emp = str(row["Employee Number"]);
    const status = str(row["Request Status"]);
    if (status.toLowerCase() !== "approved") continue;
    const note = str(row["Note"]);
    const reqDate = row["Requested Date"];
    const dateKeys: string[] = [];
    if (reqDate instanceof Date) {
      dateKeys.push(formatDateKey(reqDate));
    } else if (typeof reqDate === "string" && reqDate) {
      const parsed = new Date(reqDate);
      if (!isNaN(parsed.getTime())) dateKeys.push(formatDateKey(parsed));
      dateKeys.push(reqDate.trim());
    }
    for (const dk of dateKeys) {
      lookup.set(`${emp}|${dk}`, { note });
    }
  }
  return lookup;
}

function buildTALookup(taRows: Record<string, unknown>[], taColumns: string[]): TALookup {
  const lookup: TALookup = new Map();
  const skip = new Set(["Employee Number", "Employee Name", "Job Title", "Business Unit", "Department", "Location"]);
  const dateCols = taColumns.filter((c) => !skip.has(c));
  for (const row of taRows) {
    const emp = str(row["Employee Number"]);
    for (const dc of dateCols) {
      const val = row[dc];
      if (val !== null && val !== undefined && val !== "") {
        lookup.set(`${emp}|${String(dc).trim()}`, String(val).trim());
      }
    }
  }
  return lookup;
}

// -- Main --

export function processAttendance(
  dailyRows: Record<string, unknown>[],
  taRows: Record<string, unknown>[] | null,
  taColumns: string[] | null,
  regRows: Record<string, unknown>[] | null
): ProcessingResult {
  const validRows = dailyRows.filter((row) => {
    const d = str(row["Date"]);
    return d && isValidDate(d);
  });

  const regLookup = regRows ? buildRegLookup(regRows) : new Map<string, { note: string }>();
  const taLookup = taRows && taColumns ? buildTALookup(taRows, taColumns) : new Map<string, string>();

  const daily: DailyRow[] = [];

  for (const row of validRows) {
    const empId = str(row["Employee Number"]);
    const empName = str(row["Employee Name"]);
    const jobTitle = str(row["Job Title"]);
    const department = str(row["Department"]);
    const location = str(row["Location"]);
    const manager = str(row["Reporting Manager"]);
    const dateStr = str(row["Date"]);
    const shiftStr = str(row["Shift"]);
    const shiftStartStr = str(row["Shift Start"]);
    const shiftEndStr = str(row["Shift End"]);
    const inTimeStr = str(row["In Time"]);
    const outTimeStr = str(row["Out Time"]);
    const status = str(row["Status"]);
    const lateByRaw = str(row["Late By"]);
    const effHours = str(row["Effective Hours"]);
    const totalHours = str(row["Total Hours"]);

    const taVal = taLookup.get(`${empId}|${dateStr}`) || "";
    const shiftStartMin = parseTimeStr(shiftStartStr);
    const shiftEndMin = parseTimeStr(shiftEndStr);
    const inTimeMin = parseTimeStr(inTimeStr);
    const outTimeMin = parseTimeStr(outTimeStr);
    const lateByMin = parseDurationStr(lateByRaw);
    const effHoursMin = parseDurationStr(effHours);
    const shiftDuration = computeShiftDuration(shiftStartMin, shiftEndMin);
    const isPresent = ["P", "P(MS)", "WOW"].includes(status);

    // Late Arrival
    let lateFlag = "N/A";
    let minutesLate: number | null = null;
    if (isPresent && inTimeMin !== null && lateByMin !== null) {
      lateFlag = lateByMin > 15 ? "YES" : "NO";
      minutesLate = lateByMin;
    }

    // Missing Check-In / Check-Out
    const missingCheckIn = isPresent && inTimeMin === null ? "YES" : "NO";
    const missingCheckOut = isPresent && outTimeMin === null ? "YES" : "NO";

    // Shift Mismatch
    let mismatchFlag = "NO";
    let mismatchDetail = "";
    if (isPresent && inTimeMin !== null && shiftStartMin !== null) {
      const diff = minutesDiffCircular(shiftStartMin, inTimeMin);
      if (diff < -60) {
        mismatchFlag = "YES";
        mismatchDetail = `Clocked in ${fmtMinutes(diff)} before shift start`;
      }
    }
    if (isPresent && inTimeMin !== null && shiftStartMin !== null && mismatchFlag === "NO") {
      const diff = minutesDiffCircular(shiftStartMin, inTimeMin);
      if (Math.abs(diff) > 60 && lateByMin !== null && lateByMin <= 15) {
        mismatchFlag = "YES";
        mismatchDetail = diff < 0
          ? `Clocked in ${fmtMinutes(diff)} before shift start`
          : `Clocked in ${fmtMinutes(diff)} after shift start`;
      }
    }

    // Regularization
    const regReasons: string[] = [];
    if (missingCheckIn === "YES") regReasons.push("Missing check-in");
    if (missingCheckOut === "YES") regReasons.push("Missing check-out");
    if (mismatchFlag === "YES") regReasons.push("Shift mismatch");
    const regInfo = regLookup.get(`${empId}|${dateStr}`);
    const regFiled = regInfo ? "YES" : "NO";
    if (regInfo && regReasons.length === 0) regReasons.push("Reg filed in Keka");
    const regNeeded = regReasons.length > 0 ? "YES" : "NO";
    const regType = regInfo ? classifyRegType(regInfo.note) : "";

    // Short Day
    let shortDay = "NO";
    if (isPresent && effHoursMin !== null && shiftDuration !== null && shiftDuration > 0) {
      if (effHoursMin < shiftDuration * 0.5) shortDay = "YES";
    }

    // Integrity Flag
    let integrityFlag = "";
    if (isPresent && lateByMin !== null && lateByMin >= 14 && lateByMin <= 15) {
      integrityFlag = "REVIEW - Near buffer edge";
    }

    daily.push({
      employeeId: empId, employeeName: empName, jobTitle, department, location,
      reportingManager: manager, date: dateStr, assignedShift: shiftStr,
      shiftStart: shiftStartStr, shiftEnd: shiftEndStr, timeAssignment: taVal,
      actualClockIn: inTimeStr || "N/A", actualClockOut: outTimeStr || "N/A",
      kekaStatus: status, attendanceStatus: status,
      lateByRaw: lateByRaw || "N/A", minutesLate, lateArrivalFlag: lateFlag,
      missingCheckInFlag: missingCheckIn, missingCheckOutFlag: missingCheckOut,
      shiftMismatchFlag: mismatchFlag, shiftMismatchDetail: mismatchDetail,
      regularizationNeeded: regNeeded, regularizationReason: regReasons.join("; "),
      regularizationFiled: regFiled, regularizationType: regType,
      effectiveHours: effHours || "0:00", totalHours: totalHours || "0:00",
      shortDayFlag: shortDay, integrityFlag,
    });
  }

  // Monthly Summary
  const totalDaysInPeriod = new Set(daily.map((r) => r.date)).size;
  const grouped = new Map<string, DailyRow[]>();
  for (const row of daily) {
    const arr = grouped.get(row.employeeId) || [];
    arr.push(row);
    grouped.set(row.employeeId, arr);
  }

  const summary: SummaryRow[] = [];
  let sLate = 0, sLop = 0, sMM = 0, sRegs = 0, sBonusY = 0, sBonusN = 0, sShort = 0, sInt = 0, sAbs = 0;

  for (const [, rows] of grouped) {
    const f = rows[0];
    const absences = rows.filter((r) => r.kekaStatus === "A").length;
    const unpaidLeaves = rows.filter((r) => r.kekaStatus === "UL").length;
    const lateArrivals = rows.filter((r) => r.lateArrivalFlag === "YES").length;
    const lopDays = Math.floor(lateArrivals / 3);
    const mismatches = rows.filter((r) => r.shiftMismatchFlag === "YES").length;
    const regsNeeded = rows.filter((r) => r.regularizationNeeded === "YES").length;
    const regsFiled = rows.filter((r) => r.regularizationFiled === "YES").length;
    const shortDays = rows.filter((r) => r.shortDayFlag === "YES").length;
    const intFlags = rows.filter((r) => r.integrityFlag.startsWith("REVIEW")).length;

    // Employee-fault regs: those needing regularization that are NOT classified as system/KM error
    // If reg file was uploaded, we can determine type from notes; otherwise it's TBD for HR
    const systemRegs = rows.filter((r) => r.regularizationType === "System-or-KM-Error").length;
    const hasRegFile = rows.some((r) => r.regularizationFiled === "YES");
    // Regs that are filed but not system-error = employee fault
    // Regs that are needed but not filed = unknown (HR to confirm)
    const knownEmployeeFault = regsFiled - systemRegs;
    const unknownRegs = regsNeeded - regsFiled; // not filed yet, can't classify
    const empFaultDisplay = hasRegFile
      ? (unknownRegs > 0
        ? `${Math.max(0, knownEmployeeFault)} confirmed + ${unknownRegs} TBD`
        : String(Math.max(0, knownEmployeeFault)))
      : "TBD - HR to confirm";

    const fails: string[] = [];
    if (absences > 0) fails.push(`${absences} absence(s)`);
    if (unpaidLeaves > 0) fails.push(`${unpaidLeaves} unpaid leave(s)`);
    if (lateArrivals > 0) fails.push(`${lateArrivals} late arrival(s)`);
    // 3rd condition: >3 employee-fault regs disqualifies bonus
    if (hasRegFile && knownEmployeeFault > 3) {
      fails.push(`${knownEmployeeFault} employee-fault regularization(s)`);
    } else if (!hasRegFile && regsNeeded > 3) {
      // No reg file — can't distinguish, flag as potential issue for HR
      fails.push(`${regsNeeded} regularization(s) (fault TBD)`);
    }
    const bonusEligible = fails.length === 0 ? "YES" : "NO";

    sLate += lateArrivals; sLop += lopDays; sMM += mismatches; sRegs += regsNeeded;
    sShort += shortDays; sInt += intFlags; sAbs += absences;
    if (bonusEligible === "YES") sBonusY++; else sBonusN++;

    summary.push({
      employeeId: f.employeeId, employeeName: f.employeeName, jobTitle: f.jobTitle,
      department: f.department, location: f.location, totalDaysInPeriod,
      workingDays: rows.filter((r) => r.kekaStatus !== "WO").length,
      totalDaysPresent: rows.filter((r) => ["P", "P(MS)", "WOW"].includes(r.kekaStatus)).length,
      totalAbsences: absences,
      totalWeekOffs: rows.filter((r) => r.kekaStatus === "WO").length,
      earnedLeaves: rows.filter((r) => r.kekaStatus === "EL").length,
      unpaidLeaves, totalLateArrivals: lateArrivals, lopDays, shiftMismatches: mismatches,
      totalRegularizationsNeeded: regsNeeded, regularizationsFiled: regsFiled,
      employeeFaultRegularizations: empFaultDisplay, shortDays,
      attendanceBonusEligible: bonusEligible, bonusFailReasons: fails.join("; "),
    });
  }

  return {
    daily, summary,
    stats: {
      employees: grouped.size, dailyRecords: daily.length, lateArrivals: sLate,
      lopDays: sLop, shiftMismatches: sMM, regsNeeded: sRegs,
      bonusEligible: sBonusY, bonusNotEligible: sBonusN,
      shortDays: sShort, integrityFlags: sInt, totalAbsences: sAbs,
    },
  };
}
