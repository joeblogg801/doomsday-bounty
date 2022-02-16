//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./DoomsdayBounty.sol";

contract MockHunter {

    IDoomsday private constant doomsday = IDoomsday(0xd6e382aa7A09fc4A09C2fb99Cfce6A429985E65d);
    DoomsdayBounty private immutable bounty;

    constructor(address payable bountyContract) {
        bounty = DoomsdayBounty(bountyContract);
    }

    receive() external payable {
    }

    function collectBounty(
        uint256 winnerTokenId,
        uint256[] calldata hits,
        uint256[] calldata evacs,
        uint256[] calldata transfers
    )
        external
    {
        bytes memory data = abi.encode(hits, evacs, transfers);
        bounty.collectBounty(winnerTokenId, data);
    }

    function hunt(uint256 winnerTokenId, bytes calldata data) external {
        require(msg.sender == address(bounty));
        (uint256[] memory hits, uint256[] memory evacs, uint256[] memory transfers) =
            abi.decode(data, (uint256[], uint256[], uint256[]));

        uint256 len = hits.length;
        for (uint256 i = 0; i < len; i += 1) {
            uint256 hitId = hits[i];
            if (hitId > 0) {
                doomsday.confirmHit(hitId);
            } else {
                uint256 evacId = evacs[i];
                if (evacId > 0) {
                    bounty.evacuate(evacs[i]);
                } else {
                    bounty.transferToSelf(transfers[i]);
                }
            }
        }
    }
}
