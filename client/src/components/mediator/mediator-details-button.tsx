import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export function MediatorDetailsButton({ mediatorId }: { mediatorId: string }) {
  return <Button asChild variant="outline"><Link href={`/mediators/${mediatorId}`}>Manage mediator details</Link></Button>;
}
