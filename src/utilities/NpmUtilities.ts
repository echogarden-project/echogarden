import { request } from 'gaxios'

export async function getPackageLatestVersion(packageName: string, timeout = 10000) {
	const response = await request<any>({
		method: 'GET',

		url: `https://registry.npmjs.org/${packageName}/latest`,

		params: {
		},

		headers: {
		},

		responseType: 'json',

		timeout,
	})

	const result = response.data

	return result.version
}
