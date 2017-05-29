const rp = require('request-promise');

const RTM_EVENTS = require('@slack/client').RTM_EVENTS;

const winston = require('winston');

const META = {
    name: 'userrequests',
    short: 'Request an invite for a user -- Do not forget the ( ) they are necessary!',
    examples: [
        '@bosta invite (Full Name) (Email) (Occupation) (Company)',
    ],
};

function register(bot, rtm, web, config, secret) {
    rtm.on(RTM_EVENTS.MESSAGE, (message) => {
        if (message.text) {
            const pattern = /<@([^>]+)>:? invite \(([a-zA-Z0-9 ]+)?\) \(([<>a-zA-Z0-9_\-:@|.]+)?\) \((.+[^)])\)? \((.+[^)])\)?/;
            const [, target, fullname, email, occupation, company] = message.text.match(pattern) || [];

            if (target === bot.self.id) {
                if (fullname.length > 0 && email.length > 0 && occupation.length > 0 && company.length > 0) {
                    const timestamp = Math.floor(new Date() / 1000);
                    const postChannel = config.plugins.userrequests.invitation_request_channel;
                    const attachment = {
                        as_user: true,
                        attachments: [{
                            color: '#36a64f',
                            author_name: 'Bosta',
                            title: 'Invitation Request',
                            text: 'Attention Admins',
                            fields: [
                                {
                                    title: 'Requester',
                                    value: `<@${message.user}>`,
                                    short: false,
                                },
                                {
                                    title: 'Full Name',
                                    value: `${fullname}`,
                                    short: false,
                                },
                                {
                                    title: 'Email',
                                    value: `${email}`,
                                    short: false,
                                },
                                {
                                    title: 'Occupation',
                                    value: `${occupation}`,
                                    short: false,
                                },
                                {
                                    title: 'Company',
                                    value: `${company}`,
                                    short: false,
                                },
                            ],
                            footer: 'Automation',
                            footer_icon: 'https://platform.slack-edge.com/img/default_application_icon.png',
                            ts: timestamp,
                            // TODO: Reactivate message action buttons
                            // Temporarily Disabled
                            /* actions: [
                                {
                                    name: 'approve',
                                    text: 'Approve',
                                    type: 'button',
                                    value: 'approve',
                                },
                                {
                                    name: 'reject',
                                    text: 'Reject',
                                    type: 'button',
                                    value: 'reject',
                                    style: 'danger',
                                    confirm: {
                                        title: 'Are you sure?',
                                        text: 'This information is not stored anywhere and the invitation request will be lost!',
                                        ok_text: 'Yes',
                                        dismiss_text: 'No',
                                    },
                                },
                            ],*/
                        }],
                    };

                    informUserRequestPending(web, fullname, message.user);

                    // Notify the admins
                    web.chat.postMessage(postChannel, '', attachment, (error) => {
                        if (error) {
                            winston.error(`Could not post invitation request to ${postChannel}`, error);
                        } else {
                            winston.info(`Invitation request sent to ${postChannel}`);
                        }
                    });
                }
            }
        }
    });

    // Wait for the check mark emoji to be added to the message
    // before processing the invitation request
    rtm.on(RTM_EVENTS.REACTION_ADDED, (message) => {
        if (message.reaction == 'white_check_mark') {
            web.groups.history(message.item.channel, { latest: message.item.ts, count: 1 })
            .then((response) => {
                if (response.messages.length < 1)
                    return {};

                const pattern = /<@([^>]+)>:? invite \(([a-zA-Z0-9 ]+)?\) \(([<>a-zA-Z0-9_\-:@|.]+)?\) \((.+[^)])\)? \((.+[^)])\)?/;
                const [, target, fullname, email, occupation, company] = response.messages[0].text.match(pattern) || [];
                const requestingUser = response.messages[0].user;

                // This is an ugly fix, but the email returned in the message above
                // has the following format: <mailto:email@address.com|email@address.com>
                // so we need to extract the email only from the above
                const cleanEmail = email.slice(1,-1).split('|')[1];

                return {
                    invitee_name: fullname,
                    invitee_email: cleanEmail,
                    invitee_title: occupation,
                    slack_uid: requestingUser,
                    invitee_company: company
                }
            })
            .then((invitationRequestObj) => processInvitationRequest(invitationRequestObj, web, config, secret))
            .catch((error) => {
                winston.error(`${META.name} - Processing Invitation Error - : ${error}`);
            });
        } else if (message.reaction == 'negative_squared_cross_mark') {
            web.groups.history(message.item.channel, { latest: message.item.ts, count: 1 })
            .then((response) => { 
                if (response.messages.length < 1)
                    return {};

                const pattern = /<@([^>]+)>:? invite \(([a-zA-Z0-9 ]+)?\) \(([<>a-zA-Z0-9_\-:@|.]+)?\) \((.+[^)])\)? \((.+[^)])\)?/;
                const [, target, fullname, email, occupation, company] = response.messages[0].text.match(pattern) || [];
                const requestingUser = response.messages[0].user;

                informUserRequestDenied(web, fullname, requestingUser);
            })
            .catch((error) => {
                winston.error(`${META.name} - Processing Invitation Error - : ${error}`);
            });
        }
    });
}


function processInvitationRequest(invitationRequestObj, web, config, secret) {
    const options = {
        method: 'POST',
        uri: `${config.plugins.userrequests.menadevs_api_uri}?auth_token=${secret.menadevs_api_token}`,
        body: {
            invitation: invitationRequestObj
        },
        json: true,
        simple: false,
        resolveWithFullResponse: true
    };

    rp(options)
        .then(function (response) {
            if (response.statusCode == 201) {
                informUserRequestApproved(web, invitationRequestObj.invitee_name, invitationRequestObj.slack_uid);
            } else if (response.statusCode == 422) {
                // TODO -- Handle duplicate errors in a separate manner than
                // rejected requests by admins
                informUserRequestDenied(web, invitationRequestObj.invitee_name, invitationRequestObj.slack_uid);
            }
        })
        .catch(function(error) {
            winston.error(`${META.name} Invitation Request -- Failed: `, error);
        });
}


function informUserRequestPending(web, invitee, user_id) {
    const msg = `Hey <@${user_id}>, \
we have received your invitation request for ${invitee} and the admins are \
currently processing it. I'll keep you posted on \
its status! :wink:`;
    web.chat.postMessage(user_id, msg, { as_user: true }, (error) => {
        if (error) {
            winston.error(`${META.name} Could not respond to invitation requesting user:`, error);
        } else {
            winston.info('Invitation confirmation message was sent');
        }
    });
}


function informUserRequestApproved(web, invitee, user_id) {
    const msg = `Hello again <@${user_id}>, \
your invitation request for ${invitee} has been approved. (S)he will receive a confirmation \
email with further instructions. \
Thank you for helping spread the message!`;
    web.chat.postMessage(user_id, msg, { as_user: true }, (error) => {
        if (error) {
            winston.error(`${META.name} Could not respond to invitation requesting user:`, error);
        } else {
            winston.info('Invitation approval message was sent');
        }
    });
}


function informUserRequestDenied(web, invitee, user_id) {
    const msg = `Hello again <@${user_id}>, \
I'm afraid that your invitation request for ${invitee} has been denied. This is either because the user has been \
invited already or an admin has rejected the request. If it's the latter an admin will be in touch \
with you soon to clarify the reason.`;
    web.chat.postMessage(user_id, msg, { as_user: true }, (error) => {
        if (error) {
            winston.error(`${META.name} Could not respond to invitation requesting user:`, error);
        } else {
            winston.info('Invitation rejection message was sent');
        }
    });
}

module.exports = {
    register,
    META,
};
