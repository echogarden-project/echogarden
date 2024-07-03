export function getChromeOnWindowsHeaders({ origin }: { origin: string }) {
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
		'Origin': origin,
		'Sec-Fetch-Site': 'same-origin',
		'Sec-Fetch-Mode': 'cors',
		'Sec-Fetch-Dest': 'empty',
		'Referer': `${origin}/`,
		'Accept-Encoding': 'gzip, deflate, br',
		'Accept-Language': 'en-US,en;q=0.9',
	}

	return headers
}
