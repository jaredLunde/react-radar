import React from 'react'
import PropTypes from 'prop-types'
import {strictShallowEqual} from '@render-props/utils'
import emptyArr from 'empty/array'
import emptyObj from 'empty/object'
import {invariant} from './utils'
import Connect from './Connect'
import {EndpointConsumer} from './Store'


const WAITING = 0, ERROR = 1, LOADING = 2, DONE = 3

function getQueryID (query) {
  const fn = `${query.name}(${JSON.stringify(query.props)}) =>`
  let requires = {}

  for (let key in query.requires) {
    requires[key] = query.requires[key].requiresFields
  }

  if (__DEV__) {
    invariant(
      query.reducer.id,
      `Query reducers need to define a unique 'id' property to avoid errors ` +
      `in hydrating SSR applications. e.g. yourReducer.id = 'yourReducer'. ` +
      `It is recommended, however, that you use the 'createReducer' function ` +
      `to ensure backwards compatibility.`
    )
  }

  requires = `${query.reducer.id}(${JSON.stringify(requires)})`
  return `${fn} ${requires}`
}

function getStatusText (status) {
  switch (status) {
    case ERROR:
      return 'error'
    case DONE:
      return 'done'
    default:
      return 'loading'
  }
}

const queryShape = PropTypes.shape({
  name: PropTypes.string.isRequired,
  requires: PropTypes.object.isRequired,
  optimistic: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  rollback: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  props: PropTypes.object.isRequired,
  reducer: PropTypes.func.isRequired
})


export function createQueryComponent (opt = emptyObj) {
  let {name = 'Query', prototype = emptyObj} = opt

  class Query extends React.Component {
    id = null
    unmounted = false

    static propTypes = {
      endpoint: PropTypes.shape({
        queryCache: PropTypes.object,
        commitLocal: PropTypes.func.isRequired,
        commit: PropTypes.func.isRequired
      }),
      connect: PropTypes.string,
      run: PropTypes.oneOfType([
        PropTypes.arrayOf(queryShape),
        queryShape
      ]).isRequired,
      parallel: PropTypes.bool,
      stopIteration: PropTypes.bool
    }

    constructor (props) {
      super(props)
      this.isRadarQuery = true
      this.pending = new Set()
      this.queryContext = {
        status: 1,
        statusText: 'loading',
        queries: [],
        abort: this.abort,
        reload: this.reload,
      }
      const {endpoint: {queryCache}} = this.props
      this.queries = this.getQueries()
      const response = {}, status = {}

      for (let id in this.queries) {
        const query = queryCache.get(id)
        status[id] = query === void 0 ? WAITING : query.status

        if (query !== void 0) {
          queryCache.subscribe(id, this)

          if (query.status === Query.LOADING) {
            this.handleCommit(query.commit, {[id]: this.queries[id]})
          }

          if (query.query === void 0) {
            query.query = this.queries[id]
          }
        }

        response[id] = query ? query.response : null
      }

      this.state = {status, response}
      this.setup && this.setup()
    }

    componentDidMount () {
      this.load()
    }

    componentDidUpdate (prevProps) {
      if (strictShallowEqual(this.getID(), this.id) === false) {
        this.unsubscribeAll()
        this.queries = this.getQueries()
        this.load()
      }
    }

    componentWillUnmount () {
      this.unsubscribeAll()
      this.unmounted = true
    }

    getID = () => {
      const {run} = this.props
      return Array.isArray(run) ? run.map(getQueryID) : [getQueryID(run)]
    }

    getQueries () {
      this.id = this.getID()
      let {run, endpoint} = this.props
      const queries = {}

      if (Array.isArray(run)) {
        for (let i = 0; i < this.id.length; i++) {
          queries[this.id[i]] = run[i]
        }
      }
      else {
        queries[this.id[0]] = run
      }

      return queries
    }

    load = () => {
      // this.queries = this.getQueries()
      let {endpoint} = this.props
      const queries = {}, status = {}, response = {}

      for (let id in this.queries) {
        const query = endpoint.queryCache.get(id)
        endpoint.queryCache.subscribe(id, this)

        if (query === void 0 || query.status === WAITING) {
          queries[id] = this.queries[id]
          status[id] = LOADING
          response[id] = null
          endpoint.queryCache.set(
            id,
            {query: queries[id], status: status[id], response: null}
          )
        }
      }

      if (this.props.parallel === true) {
        const commits = []

        for (let id in queries) {
          commits.push(this.commit({[id]: queries[id]}))
        }

        return Promise.all(commits)
      }
      else {
        return this.commit(queries)
      }
    }

    updateQuery = (id, query) => {
      if (this.unmounted === true) {
        return
      }

      this.setState(
        prevState => ({
          status: {...prevState.status, [id]: query.status},
          response: {...prevState.response, [id]: query.response}
        })
      )
    }

    unsubscribeAll () {
      this.id.forEach(
        i => this.props.endpoint.queryCache.unsubscribe(i, this, this.props.parallel)
      )
    }

    commit (queriesObject) {
      const queries = Object.values(queriesObject)

      if (queries.length) {
        const commit = this.props.endpoint.commit({
          type: this.isRadarQuery ? 'QUERY' : 'UPDATE',
          queries
        })
        return this.handleCommit(commit, queriesObject)
      }

      const commits = []

      for (let id in this.queries) {
        const query = this.props.endpoint.queryCache.get(id)
        commits.push(query.commit)
      }

      return Promise.all(commits)
    }

    handleCommit (commit, queries) {
      const {endpoint: {queryCache}} = this.props
      this.pending.add(commit)

      for (let id in queries) {
        queryCache.setCommit(id, commit)
      }

      const afterCommit = ({state, response}) => {
        this.pending.delete(commit)
        const STATUS =
          response.ok === true ? DONE : ERROR

        Object.keys(queries).forEach(
          (id, i) => {
            queryCache.set(
              id,
              {
                status: STATUS,
                response: {...response, json: response.json && response.json[i]}
              }
            )
          }
        )
      }

      return commit.then(afterCommit)
    }

    abort = () => this.pending.forEach(commit => commit.cancel())

    setWaiting (ids = emptyArr) {
      ids = ids.length > 0 && typeof ids[0] === 'string' ? ids : this.id
      ids.forEach(id => this.props.endpoint.queryCache.setStatus(id, WAITING))
    }

    reload = (...ids) => {
      this.setWaiting(ids)
      this.unsubscribeAll()
      this.load()
    }

    render () {
      const statusValues = Object.values(this.state.status)
      const responseValues = Object.values(this.state.response)
      const ids = this.id
      this.queryContext.queries = []

      for (let i = 0; i < ids.length; i++) {
        this.queryContext.queries.push({
          id: ids[i],
          status: statusValues[i],
          statusText: getStatusText(statusValues[i]),
          response: responseValues[i]
        })
      }

      this.queryContext.status = Math.min(...statusValues)
      this.queryContext.statusText = getStatusText(this.queryContext.status)

      return (
        this.props.connections === void 0
          ? this.props.children(this.queryContext)
          : this.props.children(this.props.connections, this.queryContext)
      )
    }
  }

  if (__DEV__) {
    Object.defineProperty(Query, 'name', {value: name})
  }

  for (let key in prototype) {
    Query.prototype[key] = prototype[key]
  }

  function withEndpoint (Component) {
    function componentWithEndpoint (props) {
      if (props.connect) {
        return Connect({
          to: props.connect,
          children: (connections, endpoint) =>
            <Component endpoint={endpoint} connections={connections} {...props}/>
        })
      }
      else {
        return <EndpointConsumer
          children={endpoint => <Component endpoint={endpoint} {...props}/>}
        />
      }
    }

    componentWithEndpoint.WAITING = WAITING
    componentWithEndpoint.ERROR = ERROR
    componentWithEndpoint.LOADING = LOADING
    componentWithEndpoint.DONE = DONE

    if (__DEV__) {
      Object.defineProperty(
        componentWithEndpoint,
        'name',
        {value: `withEndpoint(${Component.name})`}
      )
    }

    return componentWithEndpoint
  }

  return withEndpoint(Query)
}

export default createQueryComponent()