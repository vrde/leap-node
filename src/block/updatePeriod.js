/**
 * Copyright (c) 2018-present, Leap DAO (leapdao.org)
 *
 * This source code is licensed under the Mozilla Public License Version 2.0
 * found in the LICENSE file in the root directory of this source tree.
 */

const { Period } = require('leap-core');
const submitPeriodVote = require('../period/submitPeriodVote');
const submitPeriod = require('../txHelpers/submitPeriod');
const activateSlot = require('../txHelpers/activateSlot');
const { getAuctionedByAddr } = require('../utils');
const { logPeriod } = require('../utils/debug');
const checkEnoughVotes = require('../period/utils/checkEnoughVotes');

module.exports = async (state, chainInfo, bridgeState, sender) => {
  if (bridgeState.previousPeriod) {
    const previousPeriodRoot = bridgeState.previousPeriod.merkleRoot();
    const { result } = checkEnoughVotes(previousPeriodRoot, state);
    if (result && !bridgeState.submittedPeriods[previousPeriodRoot]) {
      logPeriod(`Enough votes to submit period: ${previousPeriodRoot}`);
      try {
        await submitPeriod(
          bridgeState.previousPeriod,
          state.slots,
          bridgeState.periodHeights[previousPeriodRoot],
          bridgeState
        );
        bridgeState.submittedPeriods[previousPeriodRoot] = true;
      } catch (err) {
        /* istanbul ignore next */
        logPeriod(`submit period: ${err}`);
      }
    }
  }

  if (chainInfo.height % 32 === 0) {
    logPeriod('updatePeriod');
    try {
      bridgeState.periodHeights[bridgeState.currentPeriod.merkleRoot()] =
        chainInfo.height;
      // will be executed by all the nodes, but the actual period vote tx will be
      // submitted by validators only
      await submitPeriodVote(
        bridgeState.currentPeriod,
        state,
        bridgeState,
        sender
      );
    } catch (err) {
      /* istanbul ignore next */
      logPeriod(`period vote: ${err}`);
    }
    bridgeState.previousPeriod = bridgeState.currentPeriod;
    bridgeState.currentPeriod = new Period(
      bridgeState.previousPeriod.merkleRoot()
    );
  }
  if (chainInfo.height % 32 === 16) {
    // check if there is a validator slot that is "waiting for me"
    const myAuctionedSlots = getAuctionedByAddr(
      state.slots,
      bridgeState.account.address
    )
      .filter(({ activationEpoch }) => activationEpoch - state.epoch.epoch >= 2)
      .map(({ id }) => id);
    if (myAuctionedSlots.length > 0) {
      logPeriod('found some slots for activation', myAuctionedSlots);
      myAuctionedSlots.forEach(id => {
        const tx = activateSlot(id, bridgeState);
        /* istanbul ignore next */
        tx.catch(err => {
          logPeriod('activation error', err.message);
        });
        /* istanbul ignore next */
        if (typeof tx.on === 'function') {
          /* istanbul ignore next */
          tx.on('transactionHash', txHash => {
            logPeriod('activate', id, txHash);
          });
        }
      });
    }
  }
};
