/** 容錯解析：去掉可能的 ``` 圍籬，取第一個 {...} 區塊。各 provider 共用。 */
export function parseJSON<T>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}
