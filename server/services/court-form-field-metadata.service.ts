import {
  PDFButton,
  PDFCheckBox,
  PDFDropdown,
  PDFDocument,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  type PDFPage,
} from "pdf-lib";

export type CourtFormFieldMetadata = {
  name: string;
  type: "text" | "checkbox" | "radio" | "select" | "unsupported";
  pageIndex: number;
  widgetIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  options?: string[];
  exportValue?: string | null;
};

function getFieldType(field: unknown): CourtFormFieldMetadata["type"] {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return "select";
  if (field instanceof PDFButton) return "unsupported";
  return "unsupported";
}

function getFieldOptions(field: unknown): string[] | undefined {
  if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup) {
    const options = field.getOptions();
    return options.length ? options : undefined;
  }
  return undefined;
}

function findWidgetPage(pdf: PDFDocument, widget: any): PDFPage | undefined {
  const pages = pdf.getPages();
  const pageRef = widget.P();
  const page = pages.find((item) => item.ref === pageRef);
  if (page) return page;
  const widgetRef = pdf.context.getObjectRef(widget.dict);
  return widgetRef ? pdf.findPageForAnnotationRef(widgetRef) : undefined;
}

export async function extractCourtFormFieldMetadata(templateBytes: Buffer | Uint8Array | ArrayBuffer): Promise<CourtFormFieldMetadata[]> {
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  const pages = pdf.getPages();
  return form.getFields().flatMap((field) => {
    const widgets = field.acroField.getWidgets();
    return widgets.flatMap((widget, widgetIndex) => {
      const page = findWidgetPage(pdf, widget);
      if (!page) return [];
      const rect = widget.getRectangle();
      return [{
        name: field.getName(),
        type: getFieldType(field),
        pageIndex: pages.indexOf(page),
        widgetIndex,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        options: getFieldOptions(field),
        exportValue: field instanceof PDFCheckBox || field instanceof PDFRadioGroup ? widget.getOnValue()?.decodeText() || null : null,
      }];
    });
  });
}
