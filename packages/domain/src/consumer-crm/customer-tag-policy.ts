export type CustomerTagNamePolicyResult =
  | {
      readonly ok: true;
      readonly displayName: string;
      readonly normalizedName: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'too_long' | 'control_or_format' | 'sensitive_category';
    };

const sensitiveFragments = [
  '健康',
  '醫療',
  '疾病',
  '病史',
  '診斷',
  '藥物',
  '過敏',
  '懷孕',
  '身心障礙',
  '殘障',
  '種族',
  '族群',
  '原住民',
  '宗教',
  '佛教',
  '基督教',
  '伊斯蘭',
  '政治',
  '工會',
  '性取向',
  '性別認同',
  '性生活',
  '身分證',
  '身份證',
  '護照',
  '犯罪',
  '財務困難',
  'medical',
  'health',
  'disease',
  'diagnosis',
  'medication',
  'allergy',
  'pregnan',
  'disability',
  'race',
  'ethnic',
  'religion',
  'political',
  'tradeunion',
  'sexual',
  'genderidentity',
  'nationalid',
  'passport',
] as const;

const controlOrFormat = /[\p{Cc}\p{Cf}]/u;
const policySeparators = /[\p{Z}\p{P}\p{S}_]+/gu;

export function normalizeCustomerTagName(value: string): CustomerTagNamePolicyResult {
  const displayName = value.normalize('NFKC').trim();
  if (displayName.length === 0) return { ok: false, reason: 'empty' };
  if (Array.from(displayName).length > 32) return { ok: false, reason: 'too_long' };
  if (controlOrFormat.test(displayName)) return { ok: false, reason: 'control_or_format' };

  const normalizedName = displayName.toLocaleLowerCase('zh-TW');
  const policyName = normalizedName.replace(policySeparators, '');
  if (sensitiveFragments.some((fragment) => policyName.includes(fragment))) {
    return { ok: false, reason: 'sensitive_category' };
  }

  return { ok: true, displayName, normalizedName };
}
