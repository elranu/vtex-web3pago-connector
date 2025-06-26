import { PaymentProviderService } from '@vtex/payment-provider'

import Web3PagoConnector from './connector'

export default new PaymentProviderService({
  connector: Web3PagoConnector,
})
