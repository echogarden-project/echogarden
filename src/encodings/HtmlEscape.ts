
export function escapeHtml(text: string) {
	return text.replaceAll(
		/[&<>"']/g,
		(char) => htmlEscapeLookup[char]
	)
}

const htmlEscapeLookup: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	"'": '&#39;',
	'"': '&quot;'
}

// This HTML unescape method is not fully standard compliant
// I implemented a fully compliant one in the package html-escape-compliant
function unescapeHtml(text: string) {
	return text.replaceAll(
		/&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34|nbsp|#160);/g,
		(str) => htmlUnescapeLookup[str]
	)
}

const htmlUnescapeLookup: Record<string, string> = {
	'&amp;': '&',
	'&#38;': '&',
	'&lt;': '<',
	'&#60;': '<',
	'&gt;': '>',
	'&#62;': '>',
	'&apos;': "'",
	'&#39;': "'",
	'&quot;': '"',
	'&#34;': '"',
	'&nbsp;': '\u00A0',
	'&#160;': '\u00A0'
}
