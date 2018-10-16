import React from 'react'
import PropTypes from 'prop-types'
import Promise from 'cancelable-promise'
import emptyObj from 'empty/object'
import EndpointContext from './EndpointContext'
import createCache from './createCache'


/**
 * The Endpoint component is the glue that binds together the Networking layer,
 * Props, the Store and Context.
 * @extends React.Component
 */
class Endpoint extends React.Component {
  static propTypes = {
    cache: PropTypes.object,
    initialState: PropTypes.object,
    post: PropTypes.func.isRequired,
    updateState: PropTypes.func.isRequired
  }

  constructor (props) {
    super(props)
    this.serverRendered = props.cache.size > 0
    this.endpointContext = {
      queryCache: props.cache || createCache(),
      // local 'optimistic' updates, does not send commit over the network
      commitLocal: this.commitLocal,
      // remote + optimistic updates - commits to the network
      commit: this.commit
    }
  }

  async componentDidMount () {
    if (this.serverRendered === true) {
      await this.hydrate()
    }
  }

  hydrate () {
    return Promise.all(
      this.props.cache.map(
        async (id, query) => query.response && this.props.updateState({
          nextState: [query.response.json],
          response: query.response,
          queries: [query.query],
          type: 'QUERY'
        })
      )
    )
  }

  commit = (opt, context) => {
    const optimistic = this.commitLocal(opt)
    let {type, queries} = opt
    const payload = []

    for (let query of queries) {
      const requires = {}

      for (let key in query.requires) {
        requires[key] = query.requires[key].requiresFields
      }

      payload.push({name: query.name, props: query.props, requires})
    }

    // makes the commit 'cancelable'
    return new Promise(
      async resolve => {
        let state
        let [{response, nextState}] = await Promise.all(
          [this.commitPayload(payload, context), optimistic]
        )

        switch (response.status) {
          case   0:
          case 200:
          break;
          default:
            // execute rollbacks on the failed mutations
            const rollbacks = [], rollbackQueries = []

            for (let query of queries) {
              if (query.rollback) {
                // optimistic updates can rollback on errors
                rollbacks.push(query.rollback)
                rollbackQueries.push(query)
              }
            }

            if (rollbacks.length > 0) {
              nextState = rollbacks
              queries = rollbackQueries
              type = `ROLLBACK_${type.toUpperCase()}`
            }
        }

        state = await this.props.updateState({nextState, queries, response, type})
        this.props.cache.initialState = state

        resolve({state, response})
      }
    )
  }

  commitPayload (payload, context) {
    // posts the JSON request
    return this.props.post(payload, context).then(
      response => ({response, nextState: response.json})
    )
  }

  commitLocal = opt /*{type, queries}*/=> {
    const optimisticUpdates = [], optimisticQueries = []

    for (let query of opt.queries) {
      if (query.optimistic !== void 0 && query.optimistic !== null) {
        optimisticUpdates.push(query.optimistic)
        optimisticQueries.push(query)
      }
    }

    if (optimisticUpdates.length > 0) {
      const state = this.props.updateState({
        nextState: optimisticUpdates,
        queries: optimisticQueries,
        type: `OPTIMISTIC_${opt.type.toUpperCase()}`
      })

      this.props.cache.initialState = state
      return state
    }

    return Promise.resolve(this.props.cache.initialState || null)
  }

  render () {
    return (
      <EndpointContext.Provider value={this.endpointContext}>
        {React.Children.only(this.props.children)}
      </EndpointContext.Provider>
    )
  }
}

export default function NetworkEndpoint (props) {
  // Networking layer
  return props.network(context => <Endpoint {...context} {...props}/>)
}
