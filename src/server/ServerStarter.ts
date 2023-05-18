import { logToStderr, setupProgramTerminationListeners, setupUnhandledExceptionListeners } from '../utilities/Utilities.js'
import { startWebSocketServer } from './Server.js'

const log = logToStderr

setupUnhandledExceptionListeners()

setupProgramTerminationListeners(() => {
	log('')
})

await startWebSocketServer({}, (options) => { })
