import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BorrowerList } from "./BorrowerList";

describe("BorrowerList", () => {
  it("filters borrowers by typed query", async () => {
    const user = userEvent.setup();

    render(
      <BorrowerList
        borrowers={[
          { id: 1, cifKey: "CIF-001", memberName: "Ana Cruz", contactInfo: "111", address: "Address 1", name: "Ana Cruz", phone: "111", email: "ana@email.com" },
          { id: 2, cifKey: "CIF-002", memberName: "Mark Lee", contactInfo: "222", address: "Address 2", name: "Mark Lee", phone: "222", email: "mark@email.com" }
        ]}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    await user.type(screen.getByLabelText(/search borrowers/i), "mark");

    expect(screen.getAllByText("Mark Lee").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument();
  });
});
