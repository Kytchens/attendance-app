import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { processAttendance, type DailyRow, type SummaryRow } from "@/lib/process";

export const runtime = "nodejs";

const DAILY_HEADERS: { key: keyof DailyRow; label: string }[] = [
  { key: "employeeId", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "jobTitle", label: "Job Title" },
  { key: "department", label: "Department" },
  { key: "location", label: "Kitchen/Location" },
  { key: "reportingManager", label: "Reporting Manager" },
  { key: "date", label: "Date" },
  { key: "assignedShift", label: "Assigned Shift" },
  { key: "shiftStart", label: "Shift Start" },
  { key: "shiftEnd", label: "Shift End" },
  { key: "timeAssignment", label: "Time Assignment (Keka)" },
  { key: "actualClockIn", label: "Actual Clock-In" },
  { key: "actualClockOut", label: "Actual Clock-Out" },
  { key: "kekaStatus", label: "Keka Status" },
  { key: "attendanceStatus", label: "Attendance Status" },
  { key: "lateByRaw", label: "Late By (Raw)" },
  { key: "minutesLate", label: "Minutes Late" },
  { key: "lateArrivalFlag", label: "Late Arrival Flag" },
  { key: "missingCheckInFlag", label: "Missing Check-In Flag" },
  { key: "missingCheckOutFlag", label: "Missing Check-Out Flag" },
  { key: "shiftMismatchFlag", label: "Shift Mismatch Flag" },
  { key: "shiftMismatchDetail", label: "Shift Mismatch Detail" },
  { key: "regularizationNeeded", label: "Regularization Needed" },
  { key: "regularizationReason", label: "Regularization Reason" },
  { key: "regularizationFiled", label: "Regularization Filed (from Keka)" },
  { key: "regularizationType", label: "Regularization Type" },
  { key: "effectiveHours", label: "Effective Hours" },
  { key: "totalHours", label: "Total Hours" },
  { key: "shortDayFlag", label: "Short Day Flag" },
  { key: "integrityFlag", label: "Integrity Flag" },
];

const SUMMARY_HEADERS: { key: keyof SummaryRow; label: string }[] = [
  { key: "employeeId", label: "Employee ID" },
  { key: "employeeName", label: "Employee Name" },
  { key: "jobTitle", label: "Job Title" },
  { key: "department", label: "Department" },
  { key: "location", label: "Kitchen/Location" },
  { key: "totalDaysInPeriod", label: "Total Days in Period" },
  { key: "workingDays", label: "Working Days" },
  { key: "totalDaysPresent", label: "Total Days Present" },
  { key: "totalAbsences", label: "Total Absences" },
  { key: "totalWeekOffs", label: "Total Week-Offs" },
  { key: "earnedLeaves", label: "Earned Leaves" },
  { key: "unpaidLeaves", label: "Unpaid Leaves" },
  { key: "totalLateArrivals", label: "Total Late Arrivals" },
  { key: "lopDays", label: "LOP Days" },
  { key: "shiftMismatches", label: "Shift Mismatches" },
  { key: "totalRegularizationsNeeded", label: "Total Regularizations Needed" },
  { key: "regularizationsFiled", label: "Regularizations Filed" },
  { key: "employeeFaultRegularizations", label: "Employee-Fault Regularizations" },
  { key: "shortDays", label: "Short Days" },
  { key: "attendanceBonusEligible", label: "Attendance Bonus Eligible" },
  { key: "bonusFailReasons", label: "Bonus Fail Reason(s)" },
];

function parseExcelFile(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, columns };
}

function buildOutputExcel(daily: DailyRow[], summary: SummaryRow[]): Buffer {
  const wb = XLSX.utils.book_new();

  const dailyData = daily.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const h of DAILY_HEADERS) obj[h.label] = row[h.key] ?? "N/A";
    return obj;
  });
  const ws1 = XLSX.utils.json_to_sheet(dailyData);
  ws1["!cols"] = DAILY_HEADERS.map((h) => ({ wch: Math.min(Math.max(h.label.length + 2, 12), 35) }));
  XLSX.utils.book_append_sheet(wb, ws1, "Daily Detail");

  const summaryData = summary.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const h of SUMMARY_HEADERS) obj[h.label] = row[h.key];
    return obj;
  });
  const ws2 = XLSX.utils.json_to_sheet(summaryData);
  ws2["!cols"] = SUMMARY_HEADERS.map((h) => ({ wch: Math.min(Math.max(h.label.length + 2, 12), 35) }));
  XLSX.utils.book_append_sheet(wb, ws2, "Monthly Summary");

  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const dailyFile = formData.get("daily") as File | null;
    if (!dailyFile) {
      return NextResponse.json({ error: "Daily Performance Report is required" }, { status: 400 });
    }

    const taFile = formData.get("timeAssignments") as File | null;
    const regFile = formData.get("regularization") as File | null;
    const format = formData.get("format") as string | null;

    const { rows: dailyRows } = parseExcelFile(await dailyFile.arrayBuffer());

    let taRows: Record<string, unknown>[] | null = null;
    let taColumns: string[] | null = null;
    if (taFile) {
      const parsed = parseExcelFile(await taFile.arrayBuffer());
      taRows = parsed.rows;
      taColumns = parsed.columns;
    }

    let regRows: Record<string, unknown>[] | null = null;
    if (regFile) {
      regRows = parseExcelFile(await regFile.arrayBuffer()).rows;
    }

    const result = processAttendance(dailyRows, taRows, taColumns, regRows);

    if (format === "json") {
      return NextResponse.json(result);
    }

    const excelBuffer = buildOutputExcel(result.daily, result.summary);
    return new NextResponse(new Uint8Array(excelBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=HyprKytchen_Attendance_Processed.xlsx",
      },
    });
  } catch (error) {
    console.error("Attendance processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
