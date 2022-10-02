// eslint-disable-next-line no-unused-vars
const { Message, CommandInteraction, MessageActionRow, MessageButton, Constants, Util } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');

const CommandResult = require('../interfaces/command-result');
const { isDMChannel } = require('../modules/channel-utils');
const Logger = require('../modules/logger');
const { initialize, extractEventFilter, getMice, formatMice, sendInteractiveSearchResult,
    listFilters, getLoot, formatLoot, save, getFilter } = require('../modules/mhct-lookup');
const { splitMessageRegex } = require('../modules/format-utils');

/**
 *
 * @param {Message} message The message that triggered the action
 * @param {string[]} userArgs The tokens of the command
 * @returns {Promise<CommandResult>} Status of the execution
 */
async function doFIND(message, userArgs) {
    const theResult = new CommandResult({ message, success: false, sentDM: false });
    let reply = '';
    const opts = {};
    const urlInfo = {
        qsParams: {},
        uri: 'https://www.mhct.win/attractions.php',
        type: 'mouse',
    };
    if (!userArgs)
        reply = 'I just cannot find what you\'re looking for (since you didn\'t tell me what it was).';
    else {
        const { tokens, filter } = extractEventFilter(userArgs);
        // Set the filter if it's requested.
        if (filter) {
            opts.timefilter = filter.code_name;
        }

        // Figure out what they're searching for.
        if (tokens[tokens.length - 1].toLowerCase() === 'mouse') {
            tokens.pop();
        }
        const searchString = tokens.join(' ').toLowerCase();
        const all_mice = getMice(searchString, message.client.nicknames.get('mice'));
        if (all_mice && all_mice.length) {
            // We have multiple options, show the interactive menu.
            urlInfo.qsParams = opts;
            sendInteractiveSearchResult(all_mice, message.channel, formatMice,
                isDMChannel(message.channel), urlInfo, searchString);
            theResult.replied = true;
            theResult.success = true;
            theResult.sentDM = isDMChannel(message.channel);
        } else {
            const all_loot = getLoot(searchString, message.client.nicknames.get('loot'));
            if (all_loot && all_loot.length) {
                // We have multiple options, show the interactive menu.
                urlInfo.qsParams = opts;
                urlInfo.type = 'item';
                urlInfo.uri = 'https://www.mhct.win/loot.php';
                sendInteractiveSearchResult(all_loot, message.channel, formatLoot,
                    isDMChannel(message.channel), urlInfo, searchString);
                theResult.replied = true;
                theResult.success = true;
                theResult.sentDM = isDMChannel(message.channel);
            } else {
                reply = `I don't know anything about "${searchString}"`;
            }
        }
    }
    if (reply) {
        try {
            // Note that a lot of this is handled by sendInteractiveSearchResult.
            for (const msg of Util.splitMessage(reply, { prepend: '```\n', append: '\n```' })) {
                await message.channel.send(msg);
            }
            theResult.replied = true;
            theResult.success = true;
            theResult.sentDM = isDMChannel(message.channel);
        } catch (err) {
            Logger.error('FIND: failed to send reply', err);
            theResult.botError = true;
        }
    }
    return theResult;
}

function helpFind() {
    let reply = '-mh find [filter] mouse:\nFind the attraction rates for a mouse (nicknames allowed, filters optional).\n';
    reply += 'Known filters: `current`, ' + listFilters();
    return reply;
}

/**
 * Reply to an autotype request. Technically this could be folded into the interact?
 * @param {CommandInteraction} interaction Must be an autocomplete interaction
 */
async function autotype(interaction) {
    if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];
        if (focusedOption.name === 'mouse') {
            choices = getMice(focusedOption.value, interaction.client.nicknames.get('mice'));
            if (choices) {
                await interaction.respond(
                    choices.map(mouse => ({ name: mouse.value, value: mouse.value })),
                );
            }
        }
        else if (focusedOption.name === 'filter') {
            choices = getFilter(focusedOption.value);
            if (choices) {
                await interaction.respond(
                    choices.map(filter => ({ name: filter.code_name, value: filter.code_name })),
                );
            }
        }
    }
}

/**
 * Reply to an interaction
 * @param {CommandInteraction} interaction -- the thing to respond to
 */
async function interact(interaction) {
    if (interaction.isCommand()) {
        const filter = f => (f.customId === `fmshare_${interaction.id}` || f.customId === `fmmore_${interaction.id}`) && f.user.id === interaction.user.id;
        const moreButton = new MessageButton()
            .setCustomId(`fmmore_${interaction.id}`)
            .setLabel('More Results')
            .setStyle('PRIMARY');

        const actions = new MessageActionRow()
            .addComponents(
                new MessageButton()
                    .setCustomId(`fmshare_${interaction.id}`)
                    .setLabel('Send to Channel')
                    .setStyle('PRIMARY'),
            );
        let more_actions = '';
        // const isDM = isDMChannel(interaction.channel);
        let mouse = {};
        const all_mice = getMice(interaction.options.get('mouse').value);
        let results = 'Somehow you did not search for a mouse';
        if (all_mice && all_mice.length) {
            mouse = all_mice[0];
            results = await formatMice(true, mouse, { timefilter: interaction.options.getString('filter') || 'all_time' });
        }
        // Here we need to split the results into chunks. The button goes on the last chunk?
        const result_pages = splitMessageRegex(results, { maxLength: 2000 - 8, prepend: '```', append: '```' });
        let result_page = 0;
        if (result_pages.length > result_page + 1) {
            more_actions = actions.addComponents(moreButton);
            Logger.log(`FIND: Page ${result_page} of ${result_pages.length}`);
        } else {
            more_actions = actions;
        }
        Logger.log(`Find-mouse: We have ${result_pages.length} pages of results`);
        await interaction.reply({ content: result_pages[result_page], ephemeral: true, components: [more_actions] });
        const collector = interaction.channel.createMessageComponentCollector({ filter, time: 1 * 60 * 1000 });
        collector.on('collect', async c => {
            if (c.customId === `fmshare_${interaction.id}`) {
                const sharer = interaction.user;
                // Here we use only the first chunk of results for sharing if it's not a DM
                await c.message.channel.send( { content: `<@${sharer.id}> used \`/find-mouse ${interaction.options.getString('mouse')}\`:\n${result_pages[result_page]}` });
                await c.update({ content: 'Shared', ephemeral: false, components: [] })
                    .catch((error) => Logger.error(error));
            }
            else if (c.customId === `fmmore_${interaction.id}`) {
                // Here we use only the first chunk of results for sharing if it's not a DM
                result_page++;
                Logger.log(`Find-mouse: Sending next page of results, ${result_page}`);
                if (result_pages.length <= result_page) {
                    more_actions = actions;
                }
                // We might need a new collector?
                await c.message.channel.send({ content: result_pages[result_page], ephemeral: true, components: [more_actions] });
            }

            // await interaction.editReply({ content: results, ephemeral: false, components: [] }); // Does not stop it from being ephemeral
        });
        collector.on('end', async () => {
            await interaction.editReply({ content: results, components: [] });
        });
    } else {
        Logger.error('Somehow find-mouse command interaction was called without a mouse');
    }
}
const slashCommand = new SlashCommandBuilder()
    .setName('find-mouse')
    .setDescription('Get the attraction rates for a mouse')
    .setDMPermission(true)
    .addStringOption(option =>
        option.setName('mouse')
            .setDescription('The mouse to look up')
            .setRequired(true)
            .setAutocomplete(true))
    .addStringOption(option =>
        option.setName('filter')
            .setDescription('The specific power type to look up (Default: all)')
            .setRequired(false)
            .setAutocomplete(true));

module.exports = {
    name: 'find-mouse',
    args: true,
    usage: 'Coming Soon',
    helpFunction: helpFind,
    description: 'Find mice sorted by their attraction rates',
    canDM: true,
    aliases: [ 'mfind', 'find' ],
    slashCommand: slashCommand,
    autocompleteHandler: autotype,
    interactionHandler: interact,
    execute: doFIND,
    initialize: initialize,
    save: save,
};
