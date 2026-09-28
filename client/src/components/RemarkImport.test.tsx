import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { vi, expect, it } from "vitest";
import { RemarkImport } from "./RemarkImport";
import { apiRequest } from "../services/api";
vi.mock("../services/api", () => ({ apiRequest: vi.fn() }));
it.each(["LN-001", 12345])("previews and imports account %s using its underlying cell value", async account => {
  vi.mocked(apiRequest).mockResolvedValue({ imported: 1, remarksImported: 2, skipped: [] });
  const onImported = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  render(<RemarkImport branches={[{ id: 2, code: "BR-002", name: "Branch", address: "" }]} onImported={onImported} />);
  await user.click(screen.getByRole("button", { name: "Bulk Import Remarks" }));
  expect(screen.getByRole("dialog", { name: "Bulk Import Remarks" })).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Remarks import branch"), "2");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Loan Acct. No.", "Loan Balance", "Remarks", "Personal Visit", "Atty�s Final Demand", "Foreclosed"],
    [account, 10000, "Ignore general notes", "Visited member", "Delivered demand", ""]
  ]), "Loans");
  if (typeof account === "number") workbook.Sheets.Loans.A2.z = "0000000000";
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = new File([buffer], "remarks.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => buffer });
  await user.upload(screen.getByLabelText("Remarks spreadsheet"), file);
  expect(await screen.findByText("Visited member")).toBeInTheDocument();
  expect(screen.queryByText("Ignore general notes")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Import Remarks" }));
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/loans/remarks/import", "POST", {
    branchId: 2, rows: [{ row: 2, loanAccountNo: String(account), remarks: [
      { category: "personal_visit", description: "Visited member" },
      { category: "atty_s_final_demand", description: "Delivered demand" }
    ] }]
  }));
  expect(onImported).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
