export const numericFontSize = (
  value: number | string,
  baseSize: number,
  minimumSize: number,
  fullSizeDigits = 5,
) => {
  const digitCount = Math.max(1, String(value).replace(/\D/g, "").length);
  return `${Math.max(minimumSize, baseSize - Math.max(0, digitCount - fullSizeDigits) * 2)}px`;
};
