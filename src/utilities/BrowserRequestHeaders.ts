export function getChromeOnWindowsHeaders(options: BrowserRequestHeadersOptions) {
	const headers: Record<string, string> = {
		'Sec-Ch-Ua': `"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"`,
		'X-Same-Domain': '1',
		'Dnt': '1',
		'Sec-Ch-Ua-Mobile': '?0',
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
		'Sec-Ch-Ua-Arch': 'x86',
		'Sec-Ch-Ua-Full-Version': '125.0.6422.114',
		'Sec-Ch-Ua-Platform-Version': '"15.0.0"',
		'Sec-Ch-Ua-Full-Version-List': `"Google Chrome";v="125.0.6422.114", "Chromium";v="125.0.6422.114", "Not.A/Brand";v="24.0.0.0"`,
		'Sec-Ch-Ua-Bitness': '"64"',
		'Sec-Ch-Ua-Model': '""',
		'Sec-Ch-Ua-Platform': '"Windows"',
		'Accept': '*/*',
		'Origin': options.origin,
		'Sec-Fetch-Site': 'same-origin',
		'Sec-Fetch-Mode': 'cors',
		'Sec-Fetch-Dest': 'empty',
		'Referer': options.referrer,
		'Accept-Encoding': 'gzip, deflate, br',
		'Accept-Language': 'en-US,en;q=0.9',
	}

	return headers
}

export function getChromeOnAndroidHeaders(options: BrowserRequestHeadersOptions) {
	const headers: Record<string, string> = {
		'Sec-Ch-Ua': `"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"`,
		'Sec-Ch-Ua-Mobile': '?1',
		'Sec-Ch-Ua-Full-Version': '"126.0.6478.122"',
		'Sec-Ch-Ua-Arch': `""`,
		'Sec-Ch-Ua-Platform': `"Android"`,
		'Sec-Ch-Ua-Platform-Version': `"13"`,
		'Sec-Ch-Ua-Model': `"Pixel 5"`,
		'Sec-Ch-Ua-Bitness': `"64"`,
		'Sec-Ch-Ua-Wow64': `?0`,
		'Dnt': '1',
		'Upgrade-Insecure-Requests': '1',
		'User-Agent': `Mozilla/5.0 (Linux; Android 13; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36`,
		'Accept': '*/*',
		'Origin': options.origin,
		'Sec-Fetch-Site': 'none',
		'Sec-Fetch-Mode': 'navigate',
		'Sec-Fetch-User': '?1',
		'Sec-Fetch-Dest': 'document',
		'Referer': options.referrer,
		'Accept-Encoding': 'gzip, deflate, br',
		'Accept-Language': 'en-US,en;q=0.9',
	}

	return headers
}

export interface BrowserRequestHeadersOptions {
	origin: string
	referrer: string
}
