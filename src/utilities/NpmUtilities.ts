import { requestHttp } from 'easier-http-request'

export async function getPackageLatestVersion(packageName: string, timeout = 10000) {
	const response = await requestHttp({
		method: 'GET',

		url: `https://registry.npmjs.org/${packageName}/latest`,

		params: {
		},

		headers: {
		},

		timeout,
	})

	const responseObject = await response.json()

	return responseObject.version
}
