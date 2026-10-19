import logoWhiteBg from "@assets/Logo_white_background_1771923374048.png";
import logoTransparent from "@assets/Main_use_colour_logo_1771923374051.png";

interface BFMLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  variant?: "light" | "dark";
}

export function BFMLogoMark({ size = 40, className = "", variant = "light" }: { size?: number; className?: string; variant?: "light" | "dark" }) {
  const src = variant === "dark" ? logoTransparent : logoWhiteBg;
  return (
    <img
      src={src}
      alt="BFM Logo"
      width={size}
      height={size}
      className={`object-contain ${className}`}
      data-testid="img-bfm-logo"
    />
  );
}

export function BFMLogo({ size = 40, className = "", showText = true, variant = "light" }: BFMLogoProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <BFMLogoMark size={size} variant={variant} />
      {showText && (
        <div className="min-w-0">
          <h1 className="font-heading font-semibold text-sm leading-tight truncate">
            Brighter Future
          </h1>
          <p className="text-xs text-muted-foreground leading-tight truncate">
            Mediation
          </p>
        </div>
      )}
    </div>
  );
}
