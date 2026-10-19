import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function getPasswordStrength(pw: string): { label: string; color: string; width: string } {
  if (!pw) return { label: "", color: "", width: "0%" };
  if (pw.length < 8) return { label: "Too short", color: "bg-red-500", width: "20%" };
  let score = 0;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  if (score <= 1) return { label: "Weak", color: "bg-orange-400", width: "40%" };
  if (score === 2) return { label: "Fair", color: "bg-yellow-400", width: "60%" };
  if (score === 3) return { label: "Good", color: "bg-[#a7baa4]", width: "80%" };
  return { label: "Strong", color: "bg-[#5a7d58]", width: "100%" };
}

interface PasswordFieldProps extends Omit<React.ComponentProps<"input">, "type"> {
  showStrength?: boolean;
  toggleTestId?: string;
}

export function PasswordField({ showStrength = false, className, toggleTestId, ...props }: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  const value = typeof props.value === "string" ? props.value : "";
  const strength = getPasswordStrength(value);

  return (
    <div className="space-y-1">
      <div className="relative">
        <Input
          {...props}
          type={show ? "text" : "password"}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide password" : "Show password"}
          data-testid={toggleTestId ?? "button-toggle-password"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {showStrength && value && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", strength.color)}
              style={{ width: strength.width }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">{strength.label}</p>
        </div>
      )}
    </div>
  );
}
