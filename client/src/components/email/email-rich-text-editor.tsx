import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";

export type EmailVariable = { key: string; label: string };

export function EmailRichTextEditor({ value, onChange, variables = [] }: { value: string; onChange: (html: string) => void; variables?: EmailVariable[] }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: value,
    editorProps: { attributes: { class: "min-h-72 rounded-md border bg-background p-4 prose prose-sm max-w-none focus:outline-none" } },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const insertVariable = (key: string) => editor?.chain().focus().insertContent(`{{${key}}}`).run();
  const addLink = () => {
    if (!editor) return;
    const url = window.prompt("Link URL (https://...)", editor.getAttributes("link").href || "https://");
    if (url === null) return;
    if (!url) editor.chain().focus().unsetLink().run();
    else if (/^https:\/\//.test(url) || /^\{\{link_[a-z_]+\}\}$/.test(url)) editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1" aria-label="Email formatting">
      <Button type="button" size="sm" variant="outline" onClick={() => editor?.chain().focus().toggleBold().run()} aria-label="Bold"><strong>B</strong></Button>
      <Button type="button" size="sm" variant="outline" onClick={() => editor?.chain().focus().toggleItalic().run()} aria-label="Italic"><em>I</em></Button>
      <Button type="button" size="sm" variant="outline" onClick={() => editor?.chain().focus().toggleBulletList().run()}>Bullets</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => editor?.chain().focus().toggleOrderedList().run()}>Numbers</Button>
      <Button type="button" size="sm" variant="outline" onClick={addLink}>Link</Button>
      <select className="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Insert variable" value="" onChange={event => insertVariable(event.target.value)}>
        <option value="">Insert variable…</option>
        {variables.map(variable => <option key={variable.key} value={variable.key}>{variable.label}</option>)}
      </select>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
