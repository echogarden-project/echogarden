import { logToStderr, setupProgramTerminationListeners, setupUnhandledExceptionListeners } from '../utilities/Utilities.js'
import { startServer } from './Server.js'

const log = logToStderr

setupUnhandledExceptionListeners()

setupProgramTerminationListeners(() => {
	log('')
})

await startServer({}, (options) => { })
