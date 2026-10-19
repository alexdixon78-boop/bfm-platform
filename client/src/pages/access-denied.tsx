import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX } from "lucide-react";
import { useLocation } from "wouter";

export default function AccessDeniedPage() {
  const [, navigate] = useLocation();

  return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]" data-testid="access-denied-page">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <ShieldX className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-heading font-semibold">Access Denied</h2>
          <p className="text-muted-foreground text-sm">
            You don't have permission to view this page. Please contact your administrator if you believe this is an error.
          </p>
          <Button variant="outline" onClick={() => navigate("/")} data-testid="button-go-home">
            Go to homepage
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
