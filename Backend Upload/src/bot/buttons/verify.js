const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const config = require('../../config');
const logger = require('../../utils/logger');
const { COLORS } = require('../../utils/constants');

/**
 * Handle the Verify button click.
 * Responds with a link that sends the user to the OAuth2 flow.
 */
async function handleVerifyButton(interaction) {
  const authorizeUrl = `${config.server.baseUrl}/api/oauth/authorize?user_id=${interaction.user.id}&guild_id=${interaction.guildId}`;

  const embed = new EmbedBuilder()
    .setTitle('🔗 Verify Your Account')
    .setDescription(
      'Click the button below to verify your Discord account.\n\n' +
      'You will be redirected to Discord\'s authorization page. ' +
      'This grants us permission to verify your identity and, if needed, ' +
      'add you to future servers automatically.'
    )
    .setColor(COLORS.INFO)
    .setFooter({ text: 'Your data is securely encrypted and stored.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Verify Now →')
      .setStyle(ButtonStyle.Link)
      .setURL(authorizeUrl)
  );

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });

  logger.info('Verify button clicked', {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
}

/**
 * Send the verification panel embed with button in a specific channel.
 * Called by the bot owner or setup command.
 */
async function sendVerificationPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle('✅ Server Verification')
    .setDescription(
      '**Welcome!** To access this server, you need to verify your account.\n\n' +
      '🔒 **What does verification do?**\n' +
      '• Confirms you\'re a real person\n' +
      '• Grants you access to all channels\n' +
      '• Allows seamless migration to future servers\n\n' +
      '⚡ **How to verify:**\n' +
      'Click the **Verify** button below to start the process.\n' +
      'You\'ll be redirected to Discord to authorize, then automatically verified.'
    )
    .setColor(COLORS.SUCCESS)
    .setThumbnail(channel.guild.iconURL({ dynamic: true, size: 256 }))
    .setFooter({
      text: 'Verification System • Your data is securely encrypted',
    })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_button')
      .setLabel('✅ Verify')
      .setStyle(ButtonStyle.Success)
  );

  const message = await channel.send({
    embeds: [embed],
    components: [row],
  });

  logger.info('Verification panel sent', {
    channelId: channel.id,
    guildId: channel.guild.id,
    messageId: message.id,
  });

  return message;
}

module.exports = {
  handleVerifyButton,
  sendVerificationPanel,
};
