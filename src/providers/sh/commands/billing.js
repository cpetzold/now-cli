#!/usr/bin/env node

// Packages
const chalk = require('chalk')
const mri = require('mri')
const ms = require('ms')
const plural = require('pluralize')

// Utilities
const { handleError, error } = require('../util/error')
const NowCreditCards = require('../util/credit-cards')
const indent = require('../util/indent')
const listInput = require('../../../util/input/list')
const success = require('../../../util/output/success')
const promptBool = require('../../../util/input/prompt-bool')
const info = require('../../../util/output/info')
const logo = require('../../../util/output/logo')
const addBilling = require('./billing/add')
const exit = require('../../../util/exit')

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} now billing`)} [options] <command>

  ${chalk.dim('Options:')}

    ls                   Show all of your credit cards
    add                  Add a new credit card
    rm            [id]   Remove a credit card
    set-default   [id]   Make a credit card your default one

  ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -A ${chalk.bold.underline('FILE')}, --local-config=${chalk.bold.underline(
    'FILE'
  )}   Path to the local ${'`now.json`'} file
    -Q ${chalk.bold.underline('DIR')}, --global-config=${chalk.bold.underline(
    'DIR'
  )}    Path to the global ${'`.now`'} directory
    -d, --debug                    Debug mode [off]
    -t ${chalk.bold.underline('TOKEN')}, --token=${chalk.bold.underline(
    'TOKEN'
  )}        Login token
    -T, --team                     Set a custom team scope

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Add a new credit card (interactively)

      ${chalk.cyan(`$ now billing add`)}
  `)
}

let argv
let debug
let apiUrl
let subcommand

const main = async ctx => {
  argv = mri(ctx.argv.slice(2), {
    boolean: ['help', 'debug'],
    alias: {
      help: 'h',
      debug: 'd'
    }
  })

  argv._ = argv._.slice(1)

  debug = argv.debug
  apiUrl = ctx.apiUrl
  subcommand = argv._[0]

  if (argv.help || !subcommand) {
    help()
    await exit(0)
  }

  const {authConfig: { credentials }, config: { sh }} = ctx
  const {token} = credentials.find(item => item.provider === 'sh')

  try {
    await run({ token, sh })
  } catch (err) {
    if (err.userError) {
      console.error(error(err.message))
    } else {
      console.error(error(`Unknown error: ${err.stack}`))
    }

    exit(1)
  }
}

module.exports = async ctx => {
  try {
    await main(ctx)
  } catch (err) {
    handleError(err)
    process.exit(1)
  }
}

// Builds a `choices` object that can be passesd to inquirer.prompt()
function buildInquirerChoices(cards) {
  return cards.cards.map(card => {
    const _default =
      card.id === cards.defaultCardId ? ' ' + chalk.bold('(default)') : ''
    const id = `${chalk.cyan(`ID: ${card.id}`)}${_default}`
    const number = `${chalk.gray('#### ').repeat(3)}${card.last4}`
    const str = [
      id,
      indent(card.name, 2),
      indent(`${card.brand} ${number}`, 2)
    ].join('\n')

    return {
      name: str, // Will be displayed by Inquirer
      value: card.id, // Will be used to identify the answer
      short: card.id // Will be displayed after the users answers
    }
  })
}

async function run({ token, sh: { currentTeam, user } }) {
  const start = new Date()
  const creditCards = new NowCreditCards({ apiUrl, token, debug, currentTeam })
  const args = argv._.slice(1)

  switch (subcommand) {
    case 'ls':
    case 'list': {
      let cards
      try {
        cards = await creditCards.ls()
      } catch (err) {
        console.error(error(err.message))
        return
      }
      const text = cards.cards
        .map(card => {
          const _default =
            card.id === cards.defaultCardId ? ' ' + chalk.bold('(default)') : ''
          const id = `${chalk.gray('-')} ${chalk.cyan(
            `ID: ${card.id}`
          )}${_default}`
          const number = `${chalk.gray('#### ').repeat(3)}${card.last4}`
          let address = card.address_line1

          if (card.address_line2) {
            address += `, ${card.address_line2}.`
          } else {
            address += '.'
          }

          address += `\n${card.address_city}, `

          if (card.address_state) {
            address += `${card.address_state}, `
          }

          // Stripe is returning a two digit code for the country,
          // but we want the full country name
          address += `${card.address_zip}. ${card.address_country}`

          return [
            id,
            indent(card.name, 2),
            indent(`${card.brand} ${number}`, 2),
            indent(address, 2)
          ].join('\n')
        })
        .join('\n\n')

      const elapsed = ms(new Date() - start)
      console.log(
        `> ${
          plural('card', cards.cards.length, true)
        } found under ${chalk.bold(
          (currentTeam && currentTeam.slug) || user.username || user.email
        )} ${chalk.gray(`[${elapsed}]`)}`
      )
      if (text) {
        console.log(`\n${text}\n`)
      }

      break
    }

    case 'set-default': {
      if (args.length > 1) {
        console.error(error('Invalid number of arguments'))
        return exit(1)
      }

      const start = new Date()

      let cards
      try {
        cards = await creditCards.ls()
      } catch (err) {
        console.error(error(err.message))
        return
      }

      if (cards.cards.length === 0) {
        console.error(error('You have no credit cards to choose from'))
        return exit(0)
      }

      let cardId = args[0]

      if (cardId === undefined) {
        const elapsed = ms(new Date() - start)
        const message = `Selecting a new default payment card for ${chalk.bold(
          (currentTeam && currentTeam.slug) || user.username || user.email
        )} ${chalk.gray(`[${elapsed}]`)}`
        const choices = buildInquirerChoices(cards)

        cardId = await listInput({
          message,
          choices,
          separator: true,
          abort: 'end'
        })
      }

      // Check if the provided cardId (in case the user
      // typed `now billing set-default <some-id>`) is valid
      if (cardId) {
        const label = `Are you sure that you to set this card as the default?`
        const confirmation = await promptBool(label, {
          trailing: '\n'
        })
        if (!confirmation) {
          consoel.log(info('Aborted'))
          break
        }
        const start = new Date()
        await creditCards.setDefault(cardId)

        const card = cards.cards.find(card => card.id === cardId)
        const elapsed = ms(new Date() - start)
        console.log(success(
          `${card.brand} ending in ${card.last4} is now the default ${chalk.gray(
            `[${elapsed}]`
          )}`
        ))
      } else {
        console.log('No changes made')
      }

      break
    }

    case 'rm':
    case 'remove': {
      if (args.length > 1) {
        console.error(error('Invalid number of arguments'))
        return exit(1)
      }

      const start = new Date()
      let cards
      try {
        cards = await creditCards.ls()
      } catch (err) {
        console.error(error(err.message))
        return
      }

      if (cards.cards.length === 0) {
        console.error(error(
          `You have no credit cards to choose from to delete under ${chalk.bold(
            (currentTeam && currentTeam.slug) || user.username || user.email
          )}`
        ))
        return exit(0)
      }

      let cardId = args[0]

      if (cardId === undefined) {
        const elapsed = ms(new Date() - start)
        const message = `Selecting a card to ${chalk.underline(
          'remove'
        )} under ${chalk.bold(
          (currentTeam && currentTeam.slug) || user.username || user.email
        )} ${chalk.gray(`[${elapsed}]`)}`
        const choices = buildInquirerChoices(cards)

        cardId = await listInput({
          message,
          choices,
          separator: true,
          abort: 'start'
        })
      }

      // Shoud check if the provided cardId (in case the user
      // typed `now billing rm <some-id>`) is valid
      if (cardId) {
        const label = `Are you sure that you want to remove this card?`
        const confirmation = await promptBool(label)
        if (!confirmation) {
          console.log('Aborted')
          break
        }
        const start = new Date()
        await creditCards.rm(cardId)

        const deletedCard = cards.cards.find(card => card.id === cardId)
        const remainingCards = cards.cards.filter(card => card.id !== cardId)

        let text = `${deletedCard.brand} ending in ${deletedCard.last4} was deleted`
        //  ${chalk.gray(`[${elapsed}]`)}

        if (cardId === cards.defaultCardId) {
          if (remainingCards.length === 0) {
            // The user deleted the last card in their account
            text += `\n${chalk.yellow('Warning!')} You have no default card`
          } else {
            // We can't guess the current default card – let's ask the API
            const cards = await creditCards.ls()
            const newDefaultCard = cards.cards.find(
              card => card.id === cards.defaultCardId
            )

            text += `\n${newDefaultCard.brand} ending in ${newDefaultCard.last4} in now default for ${chalk.bold(
              (currentTeam && currentTeam.slug) || user.username || user.email
            )}`
          }
        }

        const elapsed = ms(new Date() - start)
        text += ` ${chalk.gray(`[${elapsed}]`)}`
        console.log(success(text))
      } else {
        console.log('No changes made')
      }

      break
    }

    case 'add': {
      await addBilling({
        creditCards,
        currentTeam,
        user
      })

      break
    }

    default:
      console.error(error('Please specify a valid subcommand: ls | add | rm | set-default'))
      help()
      exit(1)
  }

  creditCards.close()
}
