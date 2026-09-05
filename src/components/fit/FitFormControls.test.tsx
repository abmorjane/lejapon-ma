// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { FitInput } from "./FitFormControls";

describe("FitInput", () => {
  it("keeps an empty numeric draft editable even when the parent normalises it to zero", () => {
    function NumericFixture() {
      const [value, setValue] = useState(0);
      return <FitInput aria-label="Prix" type="number" value={value} onChange={(event) => setValue(+event.target.value)} />;
    }

    render(<NumericFixture />);
    const input = screen.getByLabelText("Prix") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "1500" } });
    expect(input.value).toBe("1500");
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.blur(input);
    expect(input.value).toBe("0");
  });

  it("does not replace an active text draft during a parent rerender", () => {
    function TextFixture() {
      const [value, setValue] = useState("Voyage au Japon");
      const [renders, setRenders] = useState(0);
      return (
        <>
          <FitInput aria-label="Programme" value={value} onChange={(event) => { setValue(event.target.value); setRenders((count) => count + 1); }} />
          <output>{renders}</output>
        </>
      );
    }

    render(<TextFixture />);
    const input = screen.getByLabelText("Programme") as HTMLInputElement;
    fireEvent.focus(input);
    input.setSelectionRange(8, 10);
    fireEvent.change(input, { target: { value: "Voyage à Japon" } });
    input.setSelectionRange(9, 9);
    expect(input.value).toBe("Voyage à Japon");
    expect(input.selectionStart).toBe(9);
  });
});
