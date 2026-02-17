export function maskApiKey(apiKey: string): string {
  if (!apiKey) {
    return "";
  }

  if (apiKey.length <= 8) {
    return "****";
  }

  return `${"*".repeat(Math.max(apiKey.length - 4, 4))}${apiKey.slice(-4)}`;
}

export function redactText(input: string): string {
  return input.replace(/sk-[A-Za-z0-9\-_]{8,}/g, "sk-****");
}
