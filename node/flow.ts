import {
  isBankInvoiceAuthorization,
  isCardAuthorization,
  isTokenizedCard,
  AuthorizationRequest,
  AuthorizationResponse,
  Authorizations,
} from '@vtex/payment-provider'

import { randomString, randomUrl } from './utils'

type Flow =
  | 'Authorize'
  | 'Denied'
  | 'Cancel'
  | 'AsyncApproved'
  | 'AsyncDenied'
  | 'BankInvoice'
  | 'Redirect'
  | 'Web3PagoPaymentApp'

export const flows: Record<
  Flow,
  (
    authorization: AuthorizationRequest,
    retry: (response: AuthorizationResponse) => void
  ) => AuthorizationResponse
> = {
  Authorize: request =>
    Authorizations.approve(request, {
      authorizationId: randomString(),
      nsu: randomString(),
      tid: randomString(),
    }),

  Denied: request => Authorizations.deny(request, { tid: randomString() }),

  Cancel: (request, retry) => flows.Authorize(request, retry),

  AsyncApproved: (request, retry) => {
    retry(
      Authorizations.approve(request, {
        authorizationId: randomString(),
        nsu: randomString(),
        tid: randomString(),
      })
    )

    return Authorizations.pending(request, {
      delayToCancel: 1000,
      tid: randomString(),
    })
  },

  AsyncDenied: (request, retry) => {
    retry(Authorizations.deny(request, { tid: randomString() }))

    return Authorizations.pending(request, {
      delayToCancel: 1000,
      tid: randomString(),
    })
  },

  BankInvoice: (request, retry) => {
    retry(
      Authorizations.approve(request, {
        authorizationId: randomString(),
        nsu: randomString(),
        tid: randomString(),
      })
    )

    return Authorizations.pendingBankInvoice(request, {
      delayToCancel: 1000,
      paymentUrl: randomUrl(),
      tid: randomString(),
    })
  },

  Redirect: (request, retry) => {
    retry(
      Authorizations.approve(request, {
        authorizationId: randomString(),
        nsu: randomString(),
        tid: randomString(),
      })
    )

    return Authorizations.redirect(request, {
      delayToCancel: 1000,
      redirectUrl: randomUrl(),
      tid: randomString(),
    })
  },

  Web3PagoPaymentApp: (request) => {
    // Generate callback URLs for the Payment App
    const baseUrl = 'https://master--basilicpartnerar.myvtex.com/_v/basilicpartnerar.web3pago-basilc-connector/v2'
    const transactionId = randomString()
    
    return Authorizations.pending(request, {
      paymentAppData: {
        appName: 'basilicpartnerar.basilic-web3pago',
        payload: JSON.stringify({
          transactionId,
          amount: request.value,
          currency: request.currency || 'USD',
          approvePaymentUrl: `${baseUrl}/approve-payment/${transactionId}`,
          denyPaymentUrl: `${baseUrl}/deny-payment/${transactionId}`,
          web3pagoData: {
            walletAddress: '',
            cryptoCurrency: 'ETH',
            networkId: '1'
          }
        })
      },
      delayToCancel: 300000, // 5 minutes timeout
      tid: randomString(),
    })
  },
}

export type CardNumber =
  | '4444333322221111'
  | '4444333322221112'
  | '4222222222222224'
  | '4222222222222225'
  | 'null'

const cardResponses: Record<CardNumber, Flow> = {
  '4444333322221111': 'Authorize',
  '4444333322221112': 'Denied',
  '4222222222222224': 'AsyncApproved',
  '4222222222222225': 'AsyncDenied',
  null: 'Redirect',
}

const findFlow = (request: AuthorizationRequest): Flow => {
  // Check if it's a Web3Pago payment method or custom payment method
  if (request.paymentMethod === 'Promissories' || 
      (request as any).paymentMethodCustomCode === 'Web3Pago') {
    return 'Web3PagoPaymentApp'
  }

  if (isBankInvoiceAuthorization(request)) return 'BankInvoice'

  if (isCardAuthorization(request)) {
    const { card } = request
    const cardNumber = isTokenizedCard(card) ? null : card.number

    return cardResponses[cardNumber as CardNumber]
  }

  return 'Authorize'
}

export const executeAuthorization = (
  request: AuthorizationRequest,
  retry: (response: AuthorizationResponse) => void
): AuthorizationResponse => {
  const flow = findFlow(request)

  return flows[flow](request, retry)
}
