const match = require('@menadevs/objectron')

module.exports = {
  name: 'juju',
  help: 'what is bad juju?',
  events: {
    message: (options, message) => {
      match(message, {
        type: 'message',
        text: /^is (?<verb>\S+) (?<what>\S+) bad juju?/
      }, result => message.reply(
                `${result.groups.what} is bad juju, people have died ${result.groups.verb} ${result.groups.what}`
      ))
    }
  }
}
