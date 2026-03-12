"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProcessingStats {
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

interface DailyRow {
  employeeId: string;
  employeeName: string;
  date: string;
  location: string;
  kekaStatus: string;
  shiftStart: string;
  actualClockIn: string;
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
  shortDayFlag: string;
  integrityFlag: string;
  effectiveHours: string;
  [key: string]: unknown;
}

interface SummaryRow {
  employeeId: string;
  employeeName: string;
  location: string;
  totalDaysPresent: number;
  totalAbsences: number;
  totalLateArrivals: number;
  lopDays: number;
  shiftMismatches: number;
  totalRegularizationsNeeded: number;
  attendanceBonusEligible: string;
  bonusFailReasons: string;
  [key: string]: unknown;
}

interface JsonResponse {
  stats: ProcessingStats;
  daily: DailyRow[];
  summary: SummaryRow[];
}

type FileKey = "daily" | "timeAssignments" | "regularization";

interface UploadArea {
  key: FileKey;
  label: string;
  required: boolean;
}

interface KitchenStat {
  location: string;
  employees: number;
  attendanceRate: number;
  lateRate: number;
  absences: number;
  bonusEligible: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const UPLOAD_AREAS: UploadArea[] = [
  { key: "daily", label: "Daily Performance Report", required: true },
  { key: "timeAssignments", label: "Time Assignments Report", required: false },
  { key: "regularization", label: "Regularization Requests", required: false },
];

type PreviewTab = "daily" | "summary" | "late" | "mismatches" | "kitchens";

const TABS: { key: PreviewTab; label: string }[] = [
  { key: "daily", label: "Daily Detail" },
  { key: "summary", label: "Monthly Summary" },
  { key: "late", label: "Late Arrivals" },
  { key: "mismatches", label: "Shift Mismatches" },
  { key: "kitchens", label: "Kitchen Leaderboard" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildFormData(files: Record<FileKey, File | null>, format?: string) {
  const fd = new FormData();
  if (files.daily) fd.append("daily", files.daily);
  if (files.timeAssignments) fd.append("timeAssignments", files.timeAssignments);
  if (files.regularization) fd.append("regularization", files.regularization);
  if (format) fd.append("format", format);
  return fd;
}

/** Status → row color class */
function rowColorClass(row: DailyRow): string {
  if (row.kekaStatus === "A") return "bg-red-50";
  if (row.lateArrivalFlag === "YES") return "bg-amber-50";
  if (row.integrityFlag && row.integrityFlag.startsWith("REVIEW")) return "bg-yellow-50";
  if (row.kekaStatus === "WO") return "bg-blue-50/40";
  if (["P", "P(MS)", "WOW"].includes(row.kekaStatus)) return "bg-emerald-50/40";
  return "";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const [files, setFiles] = useState<Record<FileKey, File | null>>({
    daily: null,
    timeAssignments: null,
    regularization: null,
  });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<JsonResponse | null>(null);
  const [excelBlob, setExcelBlob] = useState<Blob | null>(null);
  const [activeTab, setActiveTab] = useState<PreviewTab>("daily");
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Record<FileKey, HTMLInputElement | null>>({
    daily: null,
    timeAssignments: null,
    regularization: null,
  });

  /* handlers */
  const onFileChange = useCallback((key: FileKey, file: File | null) => {
    setFiles((prev) => ({ ...prev, [key]: file }));
  }, []);

  const handleProcess = useCallback(async () => {
    if (!files.daily) {
      setError("Daily Performance Report is required.");
      return;
    }
    setError(null);
    setProcessing(true);
    setData(null);
    setExcelBlob(null);
    setSelectedEmployee("");
    setSelectedLocation("");
    setEmployeeSearch("");
    setSearchOpen(false);

    try {
      const jsonRes = await fetch("/api/process", {
        method: "POST",
        body: buildFormData(files, "json"),
      });
      if (!jsonRes.ok) {
        const msg = await jsonRes.text();
        throw new Error(msg || "Processing failed");
      }
      const json: JsonResponse = await jsonRes.json();
      setData(json);

      const xlRes = await fetch("/api/process", {
        method: "POST",
        body: buildFormData(files),
      });
      if (!xlRes.ok) throw new Error("Failed to generate Excel file");
      const blob = await xlRes.blob();
      setExcelBlob(blob);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProcessing(false);
    }
  }, [files]);

  const handleDownload = useCallback(() => {
    if (!excelBlob) return;
    const url = URL.createObjectURL(excelBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "attendance_processed.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, [excelBlob]);

  /* ── Derived data ── */

  // Date range from data
  const dateRange = useMemo(() => {
    if (!data || !data.daily.length) return "";
    const dates = data.daily.map((r) => r.date).filter(Boolean);
    if (!dates.length) return "";
    return `${dates[0]} — ${dates[dates.length - 1]}`;
  }, [data]);

  // Location list
  const locationList = useMemo(() => {
    if (!data) return [];
    const locs = new Set<string>();
    for (const r of data.summary) {
      if (r.location) locs.add(r.location as string);
    }
    return Array.from(locs).sort();
  }, [data]);

  // Employee list
  const employeeList = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, string>();
    for (const r of data.summary) {
      if (!seen.has(r.employeeId)) seen.set(r.employeeId, r.employeeName as string);
    }
    let list = Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
    // Also filter by selected location
    if (selectedLocation) {
      const empIdsInLoc = new Set(
        data.summary.filter((r) => r.location === selectedLocation).map((r) => r.employeeId)
      );
      list = list.filter((e) => empIdsInLoc.has(e.id));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [data, selectedLocation]);

  // Search-filtered employee list
  const searchResults = useMemo(() => {
    if (!employeeSearch.trim()) return employeeList;
    const q = employeeSearch.toLowerCase();
    return employeeList.filter(
      (emp) => emp.name.toLowerCase().includes(q) || emp.id.toLowerCase().includes(q)
    );
  }, [employeeList, employeeSearch]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Filtered rows (by location + employee)
  const filteredDaily = useMemo(() => {
    if (!data) return [];
    let rows = data.daily;
    if (selectedLocation) rows = rows.filter((r) => r.location === selectedLocation);
    if (selectedEmployee) rows = rows.filter((r) => r.employeeId === selectedEmployee);
    return rows;
  }, [data, selectedEmployee, selectedLocation]);

  const filteredSummary = useMemo(() => {
    if (!data) return [];
    let rows = data.summary;
    if (selectedLocation) rows = rows.filter((r) => r.location === selectedLocation);
    if (selectedEmployee) rows = rows.filter((r) => r.employeeId === selectedEmployee);
    return rows;
  }, [data, selectedEmployee, selectedLocation]);

  const lateRows = useMemo(
    () => filteredDaily.filter((r) => r.lateArrivalFlag === "YES"),
    [filteredDaily]
  );
  const mismatchRows = useMemo(
    () => filteredDaily.filter((r) => r.shiftMismatchFlag === "YES"),
    [filteredDaily]
  );

  // Kitchen-wise leaderboard
  const kitchenStats = useMemo((): KitchenStat[] => {
    if (!data) return [];
    const locMap = new Map<string, SummaryRow[]>();
    for (const r of data.summary) {
      const loc = (r.location as string) || "Unknown";
      const arr = locMap.get(loc) || [];
      arr.push(r);
      locMap.set(loc, arr);
    }
    return Array.from(locMap.entries())
      .map(([location, rows]) => {
        const totalPresent = rows.reduce((s, r) => s + (r.totalDaysPresent as number), 0);
        const totalAbsences = rows.reduce((s, r) => s + (r.totalAbsences as number), 0);
        const totalLate = rows.reduce((s, r) => s + (r.totalLateArrivals as number), 0);
        const totalWorking = totalPresent + totalAbsences;
        return {
          location,
          employees: rows.length,
          attendanceRate: totalWorking > 0 ? Math.round((totalPresent / totalWorking) * 100) : 0,
          lateRate: totalPresent > 0 ? Math.round((totalLate / totalPresent) * 100) : 0,
          absences: totalAbsences,
          bonusEligible: rows.filter((r) => r.attendanceBonusEligible === "YES").length,
        };
      })
      .sort((a, b) => b.attendanceRate - a.attendanceRate);
  }, [data]);

  // Anomaly alerts
  const anomalies = useMemo(() => {
    if (!data) return [];
    const alerts: { type: string; severity: "red" | "amber" | "blue"; message: string }[] = [];

    // Employees with high late count
    for (const r of data.summary) {
      if ((r.totalLateArrivals as number) >= 5) {
        alerts.push({
          type: "High Late Count",
          severity: "red",
          message: `${r.employeeName} (${r.employeeId}) — ${r.totalLateArrivals} late arrivals`,
        });
      }
    }

    // Employees at buffer edge (integrity flags)
    const integrityEmployees = new Set<string>();
    for (const r of data.daily) {
      if (r.integrityFlag && r.integrityFlag.startsWith("REVIEW")) {
        integrityEmployees.add(`${r.employeeName} (${r.employeeId})`);
      }
    }
    for (const emp of integrityEmployees) {
      alerts.push({
        type: "Buffer Edge Pattern",
        severity: "amber",
        message: `${emp} — clocking in at 14-15 min repeatedly`,
      });
    }

    // Kitchens with high absence rate
    for (const k of kitchenStats) {
      if (k.attendanceRate < 80) {
        alerts.push({
          type: "Low Attendance Kitchen",
          severity: "red",
          message: `${k.location} — ${k.attendanceRate}% attendance rate`,
        });
      }
    }

    // Employees with 0 days present but not all WO
    for (const r of data.summary) {
      if ((r.totalDaysPresent as number) === 0 && (r.totalAbsences as number) > 0) {
        alerts.push({
          type: "Zero Attendance",
          severity: "blue",
          message: `${r.employeeName} (${r.employeeId}) — 0 days present, ${r.totalAbsences} absences`,
        });
      }
    }

    return alerts.slice(0, 15);
  }, [data, kitchenStats]);

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                   */
  /* ---------------------------------------------------------------- */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderTable(rows: any[], opts?: { maxRows?: number; colorRows?: boolean }) {
    const { maxRows, colorRows } = opts || {};
    if (!rows.length) {
      return (
        <div className="bg-white rounded-2xl border border-[#E8E8E8] py-12 text-center animate-fade-up">
          <p className="text-[13px] text-[#8E8E93]">No data to display.</p>
        </div>
      );
    }
    const display = maxRows ? rows.slice(0, maxRows) : rows;
    const cols = Object.keys(display[0]);
    return (
      <div className="bg-white rounded-2xl border border-[#E8E8E8] overflow-hidden animate-fade-up">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#E8E8E8] bg-[#FAFAFA]">
                {cols.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2.5 font-semibold text-[11px] text-[#6B7280] uppercase tracking-wide">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.map((row, i) => {
                const baseColor = colorRows ? rowColorClass(row as DailyRow) : "";
                return (
                  <tr
                    key={i}
                    className={`border-b border-[#F0F0F0] transition-colors hover:bg-black/[0.02] ${
                      baseColor || (i % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]")
                    }`}
                  >
                    {cols.map((c) => (
                      <td key={c} className="whitespace-nowrap px-3 py-2.5 text-[12px] text-[#333]">
                        {String(row[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {maxRows && rows.length > maxRows && (
          <div className="px-4 py-2.5 border-t border-[#F0F0F0] text-[11px] text-[#8E8E93]">
            Showing {maxRows} of {rows.length} rows
          </div>
        )}
      </div>
    );
  }

  function renderKitchenLeaderboard() {
    if (!kitchenStats.length) {
      return (
        <div className="bg-white rounded-2xl border border-[#E8E8E8] py-12 text-center animate-fade-up">
          <p className="text-[13px] text-[#8E8E93]">No kitchen data.</p>
        </div>
      );
    }
    return (
      <div className="space-y-2 animate-fade-up">
        {kitchenStats.map((k, i) => {
          const isGood = k.attendanceRate >= 90;
          const isBad = k.attendanceRate < 80;
          return (
            <div
              key={k.location}
              onClick={() => {
                setSelectedLocation(selectedLocation === k.location ? "" : k.location);
                setSelectedEmployee("");
              }}
              className={`bg-white rounded-2xl border p-4 transition-all cursor-pointer tap-row animate-card-pop stagger-${i + 1} ${
                selectedLocation === k.location
                  ? "border-[#FF6F3A] ring-2 ring-[#FF6F3A]/20"
                  : "border-[#E8E8E8] hover:border-[#D0D0D0] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[14px] font-bold ${
                    isGood ? "bg-emerald-50 text-emerald-600" : isBad ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                  }`}>
                    #{i + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#111111] truncate">{k.location}</p>
                    <p className="text-[11px] text-[#6B7280]">{k.employees} employees</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 text-right">
                  <div>
                    <p className={`text-[18px] font-bold ${isGood ? "text-emerald-600" : isBad ? "text-red-600" : "text-amber-600"}`}>
                      {k.attendanceRate}%
                    </p>
                    <p className="text-[10px] text-[#8E8E93]">attendance</p>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-[#333]">{k.lateRate}%</p>
                    <p className="text-[10px] text-[#8E8E93]">late rate</p>
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-emerald-600">{k.bonusEligible}</p>
                    <p className="text-[10px] text-[#8E8E93]">bonus</p>
                  </div>
                </div>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 rounded-full bg-[#F0F0F0] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isGood ? "bg-emerald-500" : isBad ? "bg-red-500" : "bg-amber-500"}`}
                  style={{ width: `${k.attendanceRate}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function currentTabContent() {
    if (!data) return null;
    switch (activeTab) {
      case "daily":
        return renderTable(filteredDaily, { maxRows: 50, colorRows: true });
      case "summary":
        return renderTable(filteredSummary);
      case "late":
        return renderTable(lateRows, { colorRows: true });
      case "mismatches":
        return renderTable(mismatchRows, { colorRows: true });
      case "kitchens":
        return renderKitchenLeaderboard();
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Main render                                                      */
  /* ---------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      {/* ── Upload Section ── */}
      <section className="animate-fade-up">
        <h2 className="text-[15px] font-semibold text-[#111111] mb-3">
          Upload Reports
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {UPLOAD_AREAS.map((area) => {
            const file = files[area.key];
            return (
              <div
                key={area.key}
                onClick={() => inputRefs.current[area.key]?.click()}
                className={`tap-target flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition-all duration-200 ${
                  file
                    ? "border-[#FF6F3A] bg-[#FFF0E6]"
                    : "border-[#D1D1D6] bg-white hover:border-[#FF6F3A] hover:bg-[#FFF7F4]"
                }`}
              >
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                  file ? "bg-[#FF6F3A]" : "bg-[#F0F0F0]"
                }`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${file ? "text-white" : "text-[#8E8E93]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    {file ? (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
                    )}
                  </svg>
                </div>
                <span className="text-[13px] font-semibold text-[#111111]">{area.label}</span>
                {!file && area.required && <span className="text-[11px] font-medium text-[#FF6F3A]">Required</span>}
                {!file && !area.required && <span className="text-[11px] text-[#8E8E93]">Optional</span>}
                {file && <span className="max-w-full truncate text-[11px] text-[#6B7280] animate-badge-in">{file.name}</span>}
                <input
                  ref={(el) => { inputRefs.current[area.key] = el; }}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => onFileChange(area.key, e.target.files?.[0] ?? null)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Actions ── */}
      <section className="flex flex-wrap items-center gap-3 animate-fade-up stagger-1">
        <button
          onClick={handleProcess}
          disabled={processing || !files.daily}
          className="tap-target flex items-center justify-between gap-3 bg-[#FF6F3A] rounded-2xl px-5 py-3.5 text-white font-semibold text-[14px] shadow-[0_4px_20px_rgba(255,85,0,0.3)] hover:shadow-[0_8px_30px_rgba(255,85,0,0.35)] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {processing && (
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {processing ? "Processing..." : "Process Attendance"}
        </button>

        {excelBlob && (
          <button
            onClick={handleDownload}
            className="tap-target flex items-center gap-2 rounded-2xl border-2 border-[#FF6F3A] px-5 py-3 text-[13px] font-semibold text-[#FF6F3A] transition-all hover:bg-[#FFF0E6] animate-badge-in"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
            </svg>
            Download Excel
          </button>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-2xl bg-red-50 ring-1 ring-red-200/50 px-4 py-2.5 animate-badge-in">
            <div className="h-6 w-6 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <span className="text-[13px] font-medium text-red-700">{error}</span>
          </div>
        )}
      </section>

      {/* ── Date Range Banner ── */}
      {data && dateRange && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-white border border-[#E8E8E8] px-4 py-3 animate-fade-up">
          <div className="h-8 w-8 rounded-lg bg-[#FFF0E6] flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#FF6F3A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#111111]">Period: {dateRange}</p>
            <p className="text-[11px] text-[#6B7280]">
              {data.stats.employees} employees across {locationList.length} kitchens
              {selectedLocation && <span className="text-[#FF6F3A] font-medium"> — filtered to {selectedLocation}</span>}
            </p>
          </div>
        </div>
      )}

      {/* ── Anomaly Alerts ── */}
      {data && anomalies.length > 0 && (
        <section className="animate-slide-up">
          <h2 className="text-[15px] font-semibold text-[#111111] mb-3">
            Alerts & Anomalies
            <span className="ml-2 text-[11px] font-medium text-[#8E8E93]">{anomalies.length} found</span>
          </h2>
          <div className="bg-white rounded-2xl border border-[#E8E8E8] overflow-hidden">
            {anomalies.map((alert, i) => {
              const config = {
                red: { dot: "bg-red-500", badge: "bg-red-50 text-red-700 ring-red-200/60" },
                amber: { dot: "bg-amber-500", badge: "bg-amber-50 text-amber-700 ring-amber-200/60" },
                blue: { dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 ring-blue-200/60" },
              }[alert.severity];
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-black/[0.02] ${
                    i < anomalies.length - 1 ? "border-b border-[#F0F0F0]" : ""
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${config.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#111111]">{alert.message}</p>
                  </div>
                  <span className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${config.badge}`}>
                    {alert.type}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Dashboard ── */}
      {data && (
        <section className="animate-slide-up">
          <h2 className="text-[15px] font-semibold text-[#111111] mb-3">Dashboard</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Employees", value: data.stats.employees, color: "#FF6F3A", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
              { label: "Late Arrivals", value: data.stats.lateArrivals, color: "#EF4444", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
              { label: "Total Absences", value: data.stats.totalAbsences, color: "#EF4444", icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" },
              { label: "LOP Days", value: data.stats.lopDays, color: "#FF9500", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" },
              { label: "Shift Mismatches", value: data.stats.shiftMismatches, color: "#FF9500", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" },
              { label: "Regs Needed", value: data.stats.regsNeeded, color: "#3B82F6", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
              { label: "Bonus Eligible", value: data.stats.bonusEligible, color: "#22C55E", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
              { label: "Not Eligible", value: data.stats.bonusNotEligible, color: "#EF4444", icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" },
              { label: "Short Days", value: data.stats.shortDays, color: "#FF9500", icon: "M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" },
              { label: "Integrity Flags", value: data.stats.integrityFlags, color: "#EF4444", icon: "M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className={`bg-white rounded-2xl border border-[#E8E8E8] p-4 transition-all hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:border-[#D0D0D0] animate-card-pop stagger-${i + 1}`}
              >
                <div className="h-9 w-9 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: `${stat.color}15` }}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" style={{ color: stat.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
                  </svg>
                </div>
                <p className="text-[28px] font-bold leading-none tracking-tight text-[#111111] animate-count-up">{stat.value}</p>
                <p className="text-[11px] mt-1.5 font-medium text-[#6B7280]">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Data Preview ── */}
      {data && (
        <section className="animate-slide-up stagger-2">
          {/* Header row with filters */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-[15px] font-semibold text-[#111111]">Data Preview</h2>
            <div className="flex flex-wrap items-center gap-2">
              {/* Location filter */}
              <select
                value={selectedLocation}
                onChange={(e) => {
                  setSelectedLocation(e.target.value);
                  setSelectedEmployee("");
                  setEmployeeSearch("");
                }}
                className="rounded-xl border border-[#E8E8E8] bg-white px-3 py-2 text-[13px] text-[#333] outline-none transition-all focus:border-[#FF6F3A] focus:ring-2 focus:ring-[#FF6F3A]/20"
              >
                <option value="">All Kitchens ({locationList.length})</option>
                {locationList.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>

              {/* Searchable employee picker */}
              <div ref={searchRef} className="relative min-w-[220px]">
                <div className="flex items-center gap-2 rounded-xl border border-[#E8E8E8] bg-white px-3 py-2 transition-all focus-within:border-[#FF6F3A] focus-within:ring-2 focus-within:ring-[#FF6F3A]/20">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[#8E8E93] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                  </svg>
                  <input
                    type="text"
                    placeholder={selectedEmployee
                      ? employeeList.find((e) => e.id === selectedEmployee)?.name || "Selected"
                      : `Search (${employeeList.length})...`
                    }
                    value={employeeSearch}
                    onChange={(e) => { setEmployeeSearch(e.target.value); setSearchOpen(true); }}
                    onFocus={() => setSearchOpen(true)}
                    className="flex-1 bg-transparent text-[13px] text-[#333] outline-none placeholder:text-[#8E8E93] min-w-0"
                  />
                  {(selectedEmployee || selectedLocation) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEmployee("");
                        setSelectedLocation("");
                        setEmployeeSearch("");
                      }}
                      className="tap-target h-5 w-5 rounded-full bg-[#E8E8E8] flex items-center justify-center flex-shrink-0 hover:bg-[#D0D0D0]"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-[#6B7280]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {searchOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-full max-h-[280px] overflow-y-auto rounded-xl border border-[#E8E8E8] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] animate-fade-up">
                    <button
                      onClick={() => { setSelectedEmployee(""); setEmployeeSearch(""); setSearchOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-[#FFF7F4] border-b border-[#F0F0F0] ${
                        !selectedEmployee ? "font-semibold text-[#FF6F3A]" : "text-[#333]"
                      }`}
                    >
                      All Employees ({employeeList.length})
                    </button>
                    {searchResults.length === 0 ? (
                      <p className="px-4 py-6 text-center text-[12px] text-[#8E8E93]">No employees found</p>
                    ) : (
                      searchResults.map((emp) => (
                        <button
                          key={emp.id}
                          onClick={() => { setSelectedEmployee(emp.id); setEmployeeSearch(""); setSearchOpen(false); }}
                          className={`w-full text-left px-4 py-2.5 text-[13px] transition-colors hover:bg-[#FFF7F4] border-b border-[#F0F0F0] last:border-0 ${
                            selectedEmployee === emp.id ? "font-semibold text-[#FF6F3A] bg-[#FFF0E6]" : "text-[#333]"
                          }`}
                        >
                          <span className="font-medium">{emp.name}</span>
                          <span className="ml-1.5 text-[11px] text-[#8E8E93]">{emp.id}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Color legend */}
          <div className="flex flex-wrap gap-3 mb-3 text-[11px] text-[#6B7280]">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-300" /> Present</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-300" /> Absent</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-300" /> Late</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-yellow-300" /> Integrity Flag</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-300" /> Week Off</span>
          </div>

          {/* Tab bar */}
          <div className="flex gap-2 overflow-x-auto mb-4 pb-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              const count =
                tab.key === "late" ? lateRows.length :
                tab.key === "mismatches" ? mismatchRows.length :
                tab.key === "daily" ? filteredDaily.length :
                tab.key === "kitchens" ? kitchenStats.length :
                filteredSummary.length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`tap-target whitespace-nowrap rounded-xl px-4 py-2 text-[12px] font-semibold transition-all duration-200 ${
                    isActive
                      ? "bg-[#FF6F3A] text-white shadow-[0_2px_8px_rgba(255,111,58,0.3)]"
                      : "bg-white text-[#6B7280] border border-[#E8E8E8] hover:text-[#111111] hover:border-[#D0D0D0]"
                  }`}
                >
                  {tab.label}
                  <span className={`ml-1.5 text-[10px] ${isActive ? "text-white/70" : "text-[#8E8E93]"}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {/* Table / Leaderboard */}
          {currentTabContent()}
        </section>
      )}
    </div>
  );
}
