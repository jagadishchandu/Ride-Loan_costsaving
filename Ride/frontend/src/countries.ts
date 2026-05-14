/**
 * Country data with phone codes and currencies for payment processing.
 * Used in registration for phone number country selection and
 * for currency-aware payment routing (e.g., PhonePe requires INR).
 */

export interface Country {
  code: string;      // ISO 3166-1 alpha-2
  name: string;
  dialCode: string;  // Phone dial code (e.g., "+91")
  currency: string;  // ISO 4217 currency code
  flag: string;      // Emoji flag
}

export const COUNTRIES: Country[] = [
  // Primary markets
  { code: "IN", name: "India", dialCode: "+91", currency: "INR", flag: "🇮🇳" },
  { code: "MX", name: "Mexico", dialCode: "+52", currency: "MXN", flag: "🇲🇽" },
  { code: "US", name: "United States", dialCode: "+1", currency: "USD", flag: "🇺🇸" },
  { code: "BR", name: "Brazil", dialCode: "+55", currency: "BRL", flag: "🇧🇷" },
  { code: "AR", name: "Argentina", dialCode: "+54", currency: "ARS", flag: "🇦🇷" },
  { code: "CO", name: "Colombia", dialCode: "+57", currency: "COP", flag: "🇨🇴" },
  { code: "CL", name: "Chile", dialCode: "+56", currency: "CLP", flag: "🇨🇱" },
  { code: "PE", name: "Peru", dialCode: "+51", currency: "PEN", flag: "🇵🇪" },
  
  // Europe
  { code: "GB", name: "United Kingdom", dialCode: "+44", currency: "GBP", flag: "🇬🇧" },
  { code: "DE", name: "Germany", dialCode: "+49", currency: "EUR", flag: "🇩🇪" },
  { code: "FR", name: "France", dialCode: "+33", currency: "EUR", flag: "🇫🇷" },
  { code: "ES", name: "Spain", dialCode: "+34", currency: "EUR", flag: "🇪🇸" },
  { code: "IT", name: "Italy", dialCode: "+39", currency: "EUR", flag: "🇮🇹" },
  { code: "PT", name: "Portugal", dialCode: "+351", currency: "EUR", flag: "🇵🇹" },
  { code: "NL", name: "Netherlands", dialCode: "+31", currency: "EUR", flag: "🇳🇱" },
  { code: "BE", name: "Belgium", dialCode: "+32", currency: "EUR", flag: "🇧🇪" },
  { code: "SE", name: "Sweden", dialCode: "+46", currency: "SEK", flag: "🇸🇪" },
  { code: "NO", name: "Norway", dialCode: "+47", currency: "NOK", flag: "🇳🇴" },
  { code: "DK", name: "Denmark", dialCode: "+45", currency: "DKK", flag: "🇩🇰" },
  { code: "PL", name: "Poland", dialCode: "+48", currency: "PLN", flag: "🇵🇱" },
  { code: "CH", name: "Switzerland", dialCode: "+41", currency: "CHF", flag: "🇨🇭" },
  { code: "AT", name: "Austria", dialCode: "+43", currency: "EUR", flag: "🇦🇹" },
  
  // Asia Pacific
  { code: "CN", name: "China", dialCode: "+86", currency: "CNY", flag: "🇨🇳" },
  { code: "JP", name: "Japan", dialCode: "+81", currency: "JPY", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", dialCode: "+82", currency: "KRW", flag: "🇰🇷" },
  { code: "SG", name: "Singapore", dialCode: "+65", currency: "SGD", flag: "🇸🇬" },
  { code: "MY", name: "Malaysia", dialCode: "+60", currency: "MYR", flag: "🇲🇾" },
  { code: "ID", name: "Indonesia", dialCode: "+62", currency: "IDR", flag: "🇮🇩" },
  { code: "TH", name: "Thailand", dialCode: "+66", currency: "THB", flag: "🇹🇭" },
  { code: "PH", name: "Philippines", dialCode: "+63", currency: "PHP", flag: "🇵🇭" },
  { code: "VN", name: "Vietnam", dialCode: "+84", currency: "VND", flag: "🇻🇳" },
  { code: "AU", name: "Australia", dialCode: "+61", currency: "AUD", flag: "🇦🇺" },
  { code: "NZ", name: "New Zealand", dialCode: "+64", currency: "NZD", flag: "🇳🇿" },
  
  // Middle East & Africa
  { code: "AE", name: "UAE", dialCode: "+971", currency: "AED", flag: "🇦🇪" },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966", currency: "SAR", flag: "🇸🇦" },
  { code: "IL", name: "Israel", dialCode: "+972", currency: "ILS", flag: "🇮🇱" },
  { code: "EG", name: "Egypt", dialCode: "+20", currency: "EGP", flag: "🇪🇬" },
  { code: "ZA", name: "South Africa", dialCode: "+27", currency: "ZAR", flag: "🇿🇦" },
  { code: "NG", name: "Nigeria", dialCode: "+234", currency: "NGN", flag: "🇳🇬" },
  { code: "KE", name: "Kenya", dialCode: "+254", currency: "KES", flag: "🇰🇪" },
  
  // Canada & Caribbean
  { code: "CA", name: "Canada", dialCode: "+1", currency: "CAD", flag: "🇨🇦" },
  { code: "JM", name: "Jamaica", dialCode: "+1", currency: "JMD", flag: "🇯🇲" },
  { code: "PR", name: "Puerto Rico", dialCode: "+1", currency: "USD", flag: "🇵🇷" },
  { code: "DO", name: "Dominican Republic", dialCode: "+1", currency: "DOP", flag: "🇩🇴" },
  
  // Central America
  { code: "GT", name: "Guatemala", dialCode: "+502", currency: "GTQ", flag: "🇬🇹" },
  { code: "CR", name: "Costa Rica", dialCode: "+506", currency: "CRC", flag: "🇨🇷" },
  { code: "PA", name: "Panama", dialCode: "+507", currency: "PAB", flag: "🇵🇦" },
];

// Default country based on app's primary market
export const DEFAULT_COUNTRY_CODE = "MX";

export function getCountryByCode(code: string): Country | undefined {
  return COUNTRIES.find(c => c.code === code);
}

export function getCountryByDialCode(dialCode: string): Country | undefined {
  return COUNTRIES.find(c => c.dialCode === dialCode);
}

// Get currency for a country code
export function getCurrencyByCountry(countryCode: string): string {
  const country = getCountryByCode(countryCode);
  return country?.currency || "MXN";
}
