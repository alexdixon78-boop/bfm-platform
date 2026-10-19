import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { BFMLogo } from "@/components/bfm-logo";

export default function ContractorHomePage() {
  const { user } = useAuth();

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-3xl mx-auto" data-testid="contractor-home-page">
      <Card>
        <CardContent className="p-8 md:p-12 text-center space-y-6">
          <div className="flex justify-center" data-testid="img-bfm-logo-contractor-home">
            <BFMLogo size={64} showText={true} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold" data-testid="text-contractor-welcome">
              Welcome, {user?.name || "Contractor"}
            </h1>
            <p className="text-muted-foreground" data-testid="text-contractor-subtitle">
              You are signed in to the Brighter Future Mediation contractor portal.
            </p>
          </div>
          <div className="border-t pt-6 space-y-3 text-left max-w-md mx-auto">
            <div className="flex items-start gap-3 text-sm">
              <Clock className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="font-medium">Your workspace is being set up</p>
                <p className="text-muted-foreground text-xs mt-1">
                  An administrator will grant you access to the relevant areas of the platform shortly.
                  You will be notified when new sections become available.
                </p>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pt-4 border-t">
            If you need help, please contact your Brighter Future Mediation administrator.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
