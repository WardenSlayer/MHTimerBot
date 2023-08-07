const { ChannelType } = require('discord.js');
//TODO: We no longer need this utility
// The ChannelType constants map between the REST API representation (number) and the programmer-friendly
// string representation. So, we need to map between them as well here, to ensure we are always comparing
// a Message object's channel.type to the appropriate literal, even if the literal's spelling changes in
// a future major version.

/** @type {{'DM': number, 'GROUP_DM': number}} */
const API_TYPE_VALUES = {
    DM: ChannelType.DM,
    GROUP_DM: ChannelType.GroupDM,
};

const DM_CHANNELS = Object.freeze(new Set([
    ChannelType[API_TYPE_VALUES.DM],
    ChannelType[API_TYPE_VALUES.GROUP_DM],
]));

// If the above mapping fails, for whatever reason, ensure the bot does not start up:
for (const type of DM_CHANNELS.values())
    if (typeof type !== 'string')
        throw new TypeError(`static assertion failed: DM_CHANNELS holds "${typeof type}" and not "string"`);

/**
 * Determines if the given channel is a DM channel (either private or group)
 * @param {{ type: number }} channel
 * @param {boolean} privateOnly Whether the channel should be a private DM (single-user).
 * @returns {boolean}
 */
function isDMChannel({ type }, privateOnly = false) {
    if (typeof type !== 'number') throw new TypeError(`Invalid argument "${arguments[0]}": expected a Channel object`);
    return privateOnly
        ? DM_CHANNELS.has(type)
        : type === ChannelType[API_TYPE_VALUES.DM];
}

exports.isDMChannel = isDMChannel;
