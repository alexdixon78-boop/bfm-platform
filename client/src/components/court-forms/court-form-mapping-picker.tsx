import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  COURT_FORM_MERGE_SOURCE_GROUPS,
  getCourtFormMergeSourceLabel,
  type CourtFormMergeSourceGroup,
} from "@shared/court-form-merge-sources";

export type PdfFieldOption = { raw: string; label: string };

type FieldMappingPickerProps = {
  value: string;
  options: PdfFieldOption[];
  onChange: (value: string) => void;
  placeholder?: string;
};

type SourceMappingPickerProps = {
  value: string;
  onChange: (value: string) => void;
  groups?: CourtFormMergeSourceGroup[];
};

export function FieldMappingPicker({
  value,
  options,
  onChange,
  placeholder = "PDF field",
}: FieldMappingPickerProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.raw === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between overflow-hidden px-3 font-normal"
        >
          <span className="truncate text-left">{selectedOption?.label || formatPdfFieldLabel(value) || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search PDF fields..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No PDF field found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.raw}
                  value={option.raw}
                  keywords={[option.label]}
                  onSelect={() => {
                    onChange(option.raw);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4", value === option.raw ? "opacity-100" : "opacity-0")} />
                  <span className="break-words">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SourceMappingPicker({
  value,
  onChange,
  groups,
}: SourceMappingPickerProps) {
  const [open, setOpen] = useState(false);
  const sourceGroups = groups?.length ? groups : COURT_FORM_MERGE_SOURCE_GROUPS;
  const selectedLabel = getCourtFormMergeSourceLabel(value);
  const hasCurrentSource = sourceGroups
    .flatMap((group) => group.options)
    .some((source) => source.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-full justify-between overflow-hidden px-3 font-normal"
        >
          <span className="truncate text-left">{selectedLabel || "Source"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search sources..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No source found.</CommandEmpty>
            {value && !hasCurrentSource && (
              <CommandGroup heading="Current value">
                <CommandItem
                  value={value}
                  keywords={[selectedLabel]}
                  onSelect={() => {
                    onChange(value);
                    setOpen(false);
                  }}
                >
                  <Check className="h-4 w-4 opacity-100" />
                  <span className="break-words">{selectedLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {sourceGroups.map((group) => (
              <CommandGroup key={group.groupLabel} heading={group.groupLabel}>
                {group.options.map((source) => (
                  <CommandItem
                    key={source.value}
                    value={source.value}
                    keywords={[source.label]}
                    onSelect={() => {
                      onChange(source.value);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("h-4 w-4", value === source.value ? "opacity-100" : "opacity-0")} />
                    <span className="break-words">{source.label}{source.sensitive ? " (sensitive)" : ""}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function formatPdfFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/&#x20;/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
