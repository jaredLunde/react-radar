import React from 'react'
import PropTypes from 'prop-types'


// preloads all of the queries used in the current react tree
export class WaitForPromises {
  // Map from Query component instances to pending promises.
  chunkPromises = []

  load () {
    return Promise.all(this.chunkPromises).then(() => this.chunkPromises = [])
  }
}

export default (app, render = require('react-dom/server').renderToStaticMarkup) => {
  const waitForPromises = new WaitForPromises()

  class WaitForPromisesProvider extends React.Component {
    static childContextTypes = {
      waitForPromises: PropTypes.object,
    }

    getChildContext () {
      return {waitForPromises}
    }

    render () {
      return app
    }
  }

  const process = () => {
    const html = render(<WaitForPromisesProvider/>)
    return waitForPromises.chunkPromises.length > 0
      ? waitForPromises.load().then(process)
      : html
  }

  return Promise.resolve().then(process)
}