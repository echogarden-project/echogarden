import { makeTarballsForInstalledPackages } from '../utilities/TarballMaker.js'
import { logToStderr, setupProgramTerminationListeners } from '../utilities/Utilities.js'

const log = logToStderr

setupProgramTerminationListeners()

//process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
//process.env.http_proxy = 'http://localhost:8080'

//await makeTarballsForInstalledPackages(true)

process.exit(0)

