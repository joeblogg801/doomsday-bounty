//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

interface IDoomsday {
    function balanceOf(address _owner) external view returns (uint256);
    function confirmHit(uint256 _tokenId) external;
    function destroyed() external view returns (uint256);
    function evacuate(uint256 _tokenId) external;
    function getStructuralData(uint256 _tokenId) external view returns (uint8 reinforcement, uint8 damage, bytes32 lastImpact);
    function ownerOf(uint256 _tokenId) external view returns (address);
    function setApprovalForAll(address _operator, bool _approved) external;
    function totalSupply() external view returns (uint256);
    function transferFrom(address _from, address _to, uint256 _tokenId) external;
    function winnerPrize(uint256 _tokenId) external view returns (uint256);
    function winnerWithdraw(uint256 _winnerTokenId) external;
}

interface IHunterCallback {
    function hunt(uint256 winnerTokenId, bytes calldata data) external;
}

contract DoomsdayBounty {

    uint256 private constant RESTING = 1;
    uint256 private constant HUNTING = 2;

    uint256 private status;

    uint256 public bountyFee;

    IDoomsday private constant doomsday = IDoomsday(0xd6e382aa7A09fc4A09C2fb99Cfce6A429985E65d); // solhint-disable-line const-name-snakecase
    address private constant DAO = 0x7BB7bd0e8923B1f698eeaf0AB49834B8f1810d58;

    constructor() {
        status = RESTING;
        bountyFee = 50; // 5%
    }

    receive() external payable { // solhint-disable-line no-empty-blocks
    }

    modifier onlyDAO {
        require(msg.sender == DAO, "not DAO");
        _;
    }

    function setBountyFee(uint256 value) external onlyDAO {
        require(value <= 100, "too generous"); // no more than 10%
        bountyFee = value;
    }

    function collectBounty(uint256 winnerTokenId, bytes calldata hunterData) external {
        require(status == RESTING, "not resting");

        {
            // allow bounty only if DAO did not win yet
            uint256 balanceOfDAO = doomsday.balanceOf(DAO);
            uint256 totalSupply = doomsday.totalSupply();
            require(balanceOfDAO < totalSupply, "DAO won");
        }

        status = HUNTING;
        IHunterCallback(msg.sender).hunt(winnerTokenId, hunterData);
        status = RESTING;

        require(doomsday.totalSupply() == 1, "game not finished");
        require(doomsday.ownerOf(winnerTokenId) == address(this), "winner not owned");

        uint256 prize = doomsday.winnerPrize(winnerTokenId);
        require(prize > 150 ether, "small prize");
        uint256 balanceBeforeWithdraw = address(this).balance;
        // will fail if winnings were withdrawn already
        doomsday.winnerWithdraw(winnerTokenId);
        uint256 balanceAfterWithdraw = address(this).balance;
        require(balanceAfterWithdraw - balanceBeforeWithdraw == prize, "prize not received");

        uint256 hunterFee = address(this).balance * bountyFee / 1000;
        if (hunterFee > 0) {
            safeTransferETH(msg.sender, hunterFee);
        }
        safeTransferETH(DAO, address(this).balance);

        // note that the winner bunker stays in the contract
        // and can be claimed later via transferToDAO call
    }

    function evacuate(uint256 tokenId) external {
        require(status == HUNTING, "not hunting");
        doomsday.transferFrom(DAO, address(this), tokenId);
        doomsday.evacuate(tokenId);
    }

    function transferToSelf(uint256 tokenId) external {
        require(status == HUNTING, "not hunting");
        doomsday.transferFrom(DAO, address(this), tokenId);
    }

    function transferToDAO(uint256 tokenId) external {
        // anybody can transfer token to DAO out of this contract
        doomsday.transferFrom(address(this), DAO, tokenId);
        require(doomsday.ownerOf(tokenId) == DAO, "not owner");
    }

    function withdraw(uint256 amount) external onlyDAO {
        safeTransferETH(DAO, amount);
    }

    // escape hatch, allows DAO to make any calls to withdraw ETH, rescue bunkers, etc
    function call(address payable to, uint256 value, bytes calldata data) external payable onlyDAO returns (bytes memory) {
        require(to != address(0), "zero address");
        (bool success, bytes memory result) = to.call{value: value}(data); // solhint-disable-line avoid-low-level-calls
        require(success, "call failed");
        return result;
    }

    function safeTransferETH(address to, uint256 value) private {
        (bool success, ) = to.call{value: value}(new bytes(0)); // solhint-disable-line avoid-low-level-calls
        require(success, "transfer failed");
    }
}
