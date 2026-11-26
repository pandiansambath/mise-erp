"use client";

import Link from "next/link";

import { SheetPopup } from "@/components/SheetPopup";

/** How pay is worked out, asked for and not pinned open above the runs. */
export function PayrollHelp({ onClose }: { onClose: () => void }) {
  const box = "mise-well rounded-xl p-3";
  return (
    <SheetPopup onClose={onClose} title="How payroll works" columns={3}>
      <div className="grid gap-3 text-sm text-fg-soft md:grid-cols-2">
        <div className={box}>
          <p className="font-semibold text-fg">Draft, Approved, Paid</p>
          <p className="mt-1">
            {"A "}
            <b className="text-fg">draft</b>
            {" is worked out and agreed by nobody. "}
            <b className="text-fg">Approved</b>
            {" is agreed, and still not money: it is not in Expenses or in your profit. "}
            <b className="text-fg">Paid</b>
            {" is the day the money went, and only then is it in "}
            <Link href="/expenses" className="text-brand-400 underline">
              Expenses
            </Link>
            {", under Staff Salaries, on that day."}
          </p>
        </div>
        <div className={box}>
          <p className="font-semibold text-fg">Nobody is paid twice</p>
          <p className="mt-1">
            A day that is in a run is left out of every other one. Open the person, tap the day, and you can
            pay it again on purpose. Nothing else will.
          </p>
        </div>
        <div className={box}>
          <p className="font-semibold text-fg">Hourly staff</p>
          <p className="mt-1">
            Minutes worked, from Attendance, at their rate. Each day is rounded to the penny and the days are
            added up. The rate must be at least your minimum wage, set in Settings.
          </p>
        </div>
        <div className={box}>
          <p className="font-semibold text-fg">Salaried staff</p>
          <p className="mt-1">
            The days they came in, at salary divided by your working days, with time past eight hours at time
            and a half. Or choose “Salary, shared out”: every day of the month is an equal part of it.
          </p>
        </div>
        <div className={box}>
          <p className="font-semibold text-fg">Extras, advances and holding back</p>
          <p className="mt-1">
            Bonus, tips, money back and deductions each have a name and show on the payslip. An advance is
            taken back by itself when it is due, as far as the pay covers it, and the rest stays owed. Hold
            somebody back and they are not approved or paid with the others.
          </p>
        </div>
        <div className={box}>
          <p className="font-semibold text-fg">Undo, and Recall</p>
          <p className="mt-1">
            Undo payment puts people back to approved and takes the wages out of Expenses. Recall takes a run,
            or one person in it, back as if it had never been made. If money was marked as paid it asks you to
            type RECALL and say why, and that one line is kept.
          </p>
        </div>
        <p className={`${box} text-xs text-fg-faint md:col-span-2`}>
          {"No tax or National Insurance is worked out: every figure is before tax. Don’t also type Staff Salaries in Profile under overheads: paid wages are in Expenses already, and that would count them twice. Rates are set on "}
          <Link href="/employees" className="text-brand-400 underline">
            Employees
          </Link>
          {", hours on "}
          <Link href="/attendance" className="text-brand-400 underline">
            Attendance
          </Link>
          {"."}
        </p>
      </div>
    </SheetPopup>
  );
}
