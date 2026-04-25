export interface AgentEditPreview {
  beforePreview: string;
  afterPreview: string;
  beforeLineCount: number;
  afterLineCount: number;
  lineDelta: number;
}

const previewLineLimit = 8;
const previewCharacterLimit = 360;

function countLines(value: string): number {
  if (!value) {
    return 0;
  }

  return value.split(/\r?\n/).length;
}

function trimPreview(value: string): string {
  const normalizedValue = value.replace(/\r\n/g, "\n");
  const lines = normalizedValue.split("\n");
  const trimmedLines = lines.slice(0, previewLineLimit);
  let preview = trimmedLines.join("\n");

  if (preview.length > previewCharacterLimit) {
    preview = `${preview.slice(0, previewCharacterLimit).trimEnd()}\n...`;
    return preview;
  }

  if (lines.length > previewLineLimit) {
    return `${preview}\n...`;
  }

  return preview;
}

export function buildAgentEditPreview(findText: string, replaceText: string): AgentEditPreview {
  return {
    beforePreview: trimPreview(findText),
    afterPreview: trimPreview(replaceText),
    beforeLineCount: countLines(findText),
    afterLineCount: countLines(replaceText),
    lineDelta: countLines(replaceText) - countLines(findText)
  };
}
