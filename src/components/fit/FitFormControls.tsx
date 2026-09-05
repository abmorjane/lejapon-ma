import * as React from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InputProps = React.ComponentPropsWithoutRef<typeof Input>;
type DraftValue = string | number | readonly string[] | undefined;

function useStableDraft(value: DraftValue) {
  const [draft, setDraft] = React.useState<DraftValue>(value ?? "");
  const focusedRef = React.useRef(false);

  React.useLayoutEffect(() => {
    // A recalculation or a delayed persistence response must not replace the
    // value currently being edited. Synchronisation resumes after blur.
    if (!focusedRef.current) setDraft(value ?? "");
  }, [value]);

  return { draft, setDraft, focusedRef };
}

/**
 * FIT forms contain large calculated sections. This input keeps a local draft
 * while focused so parent recalculations cannot reset the caret or force an
 * empty numeric value back to zero during the same editing gesture.
 */
export const FitInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ value, defaultValue, onChange, onFocus, onBlur, ...props }, forwardedRef) => {
    const { draft, setDraft, focusedRef } = useStableDraft(value ?? defaultValue);

    return (
      <Input
        {...props}
        ref={forwardedRef}
        value={draft}
        onFocus={(event) => {
          focusedRef.current = true;
          onFocus?.(event);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          onBlur?.(event);
          // Empty numeric drafts resume the parent's normalised 0/null value.
          // Non-empty drafts remain authoritative so a stale async response
          // received during focus cannot suddenly replace the user's edit.
          if (props.type === "number" && draft === "") setDraft(value ?? "");
        }}
      />
    );
  },
);
FitInput.displayName = "FitInput";

type FitTextareaProps = React.ComponentPropsWithoutRef<typeof Textarea>;

export const FitTextarea = React.forwardRef<HTMLTextAreaElement, FitTextareaProps>(
  ({ value, defaultValue, onChange, onFocus, onBlur, ...props }, forwardedRef) => {
    const { draft, setDraft, focusedRef } = useStableDraft(value ?? defaultValue);

    return (
      <Textarea
        {...props}
        ref={forwardedRef}
        value={draft}
        onFocus={(event) => {
          focusedRef.current = true;
          onFocus?.(event);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event);
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          onBlur?.(event);
        }}
      />
    );
  },
);
FitTextarea.displayName = "FitTextarea";
