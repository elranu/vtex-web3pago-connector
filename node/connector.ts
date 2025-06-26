/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios'
import {
  AuthorizationRequest, 
  AuthorizationResponse,
  CancellationRequest,
  CancellationResponse,
  Cancellations,
  PaymentProvider,
  RefundRequest,
  RefundResponse,
  Refunds,
  SettlementRequest,
  SettlementResponse,
  Settlements,
  Authorizations,
} from '@vtex/payment-provider'
import { VBase } from '@vtex/api'

import { randomString } from './utils'
import { executeAuthorization } from './flow'

const web3PagoUrl = 'https://happy-pangolin-reliably.ngrok-free.app/api/vtex'
const authorizationsBucket = 'authorizations'
const pendingTransactionsBucket = 'pending-transactions'

const persistAuthorizationResponse = async (
  vbase: VBase,
  resp: AuthorizationResponse
) => vbase.saveJSON(authorizationsBucket, resp.paymentId, resp)

const getPersistedAuthorizationResponse = async (
  vbase: VBase,
  req: AuthorizationRequest
) =>
  vbase.getJSON<AuthorizationResponse | undefined>(
    authorizationsBucket,
    req.paymentId,
    true
  )

const persistPendingTransaction = async (
  vbase: VBase,
  transactionId: string,
  authRequest: AuthorizationRequest
) => vbase.saveJSON(pendingTransactionsBucket, transactionId, authRequest)

const getPendingTransaction = async (
  vbase: VBase,
  transactionId: string
) =>
  vbase.getJSON<AuthorizationRequest | undefined>(
    pendingTransactionsBucket,
    transactionId,
    true
  )

const sendRequest = async (url: string, body: any): Promise<any> => {
  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Error: ${response.statusText}`)
    }

    return response.data
  } catch (error) {
    console.error('Error sending request:', error)

    return null
  }
}

export default class Web3PagoConnector extends PaymentProvider {
  // This class needs modifications to pass the test suit.
  // Refer to https://help.vtex.com/en/tutorial/payment-provider-protocol#4-testing
  // in order to learn about the protocol and make the according changes.

  private async saveAndRetry(
    req: AuthorizationRequest,
    resp: AuthorizationResponse
  ) {
    await persistAuthorizationResponse(this.context.clients.vbase, resp)
    this.callback(req, resp)
  }

  public async authorize(
    authorization: AuthorizationRequest
  ): Promise<AuthorizationResponse> {
    await sendRequest(web3PagoUrl, authorization)

    const persistedResponse = await getPersistedAuthorizationResponse(
      this.context.clients.vbase,
      authorization
    )

    if (persistedResponse !== undefined && persistedResponse !== null) {
      return persistedResponse
    }

    const response = executeAuthorization(authorization, response =>
      this.saveAndRetry(authorization, response)
    )

    // If this is a Web3Pago payment app response, store the pending transaction
    if ((response as any).paymentAppData) {
      const payload = JSON.parse((response as any).paymentAppData.payload)
      if (payload.transactionId) {
        await persistPendingTransaction(
          this.context.clients.vbase,
          payload.transactionId,
          authorization
        ).catch((error: any) => console.error('Error storing pending transaction:', error))
      }
    }

    return response
  }

  public async cancel(
    cancellation: CancellationRequest
  ): Promise<CancellationResponse> {
    await sendRequest(web3PagoUrl, cancellation)

    return Cancellations.approve(cancellation, {
      cancellationId: randomString(),
    })
  }

  public async refund(refund: RefundRequest): Promise<RefundResponse> {
    await sendRequest(web3PagoUrl, refund)

    return Refunds.deny(refund)
  }

  public async settle(
    settlement: SettlementRequest
  ): Promise<SettlementResponse> {
    await sendRequest(web3PagoUrl, settlement)

    return Settlements.deny(settlement)
  }

  public async inbound(request: any): Promise<any> {
    const { url, method } = request
    
    // Handle approve payment
    if (method === 'POST' && url.includes('/approve-payment/')) {
      const transactionId = url.split('/approve-payment/')[1]
      
      try {
        console.log('Approving payment for transaction:', transactionId)
        
        // Get the pending transaction
        const authRequest = await getPendingTransaction(
          this.context.clients.vbase,
          transactionId
        )
        
        if (!authRequest) {
          return {
            status: 404,
            data: { error: 'Transaction not found' }
          }
        }
        
        // Create approval response
        const approvalResponse = Authorizations.approve(authRequest, {
          authorizationId: randomString(),
          nsu: randomString(),
          tid: randomString(),
        })
        
        // Persist the approval
        await persistAuthorizationResponse(
          this.context.clients.vbase, 
          approvalResponse
        )
        
        // Call the callback to notify VTEX
        this.callback(authRequest, approvalResponse)
        
        return {
          status: 200,
          data: { success: true }
        }
      } catch (error) {
        console.error('Error approving payment:', error)
        return {
          status: 500,
          data: { error: 'Internal server error' }
        }
      }
    }
    
    // Handle deny payment
    if (method === 'POST' && url.includes('/deny-payment/')) {
      const transactionId = url.split('/deny-payment/')[1]
      
      try {
        console.log('Denying payment for transaction:', transactionId)
        
        // Get the pending transaction
        const authRequest = await getPendingTransaction(
          this.context.clients.vbase,
          transactionId
        )
        
        if (!authRequest) {
          return {
            status: 404,
            data: { error: 'Transaction not found' }
          }
        }
        
        // Create denial response
        const denialResponse = Authorizations.deny(authRequest, {
          tid: randomString(),
        })
        
        // Persist the denial
        await persistAuthorizationResponse(
          this.context.clients.vbase,
          denialResponse
        )
        
        // Call the callback to notify VTEX
        this.callback(authRequest, denialResponse)
        
        return {
          status: 200,
          data: { success: true }
        }
      } catch (error) {
        console.error('Error denying payment:', error)
        return {
          status: 500,
          data: { error: 'Internal server error' }
        }
      }
    }
    
    return {
      status: 404,
      data: { error: 'Endpoint not found' }
    }
  }
}
