# Short description
This is a bounty contract issued by DAO to help them to win in the Doomsday NFT game.
DAO agrees to pay a percentage of winning prize to anybody who could secure a win.
To help the bounty hunter DAO agrees to grant additional rights to the bounty hunter
- DAO grants right to evacuate any bunker owned by DAO
- DAO grants right to transfer any bunker owned by DAO to the bounty contract
subject to the following condition: DAO receives a (winning prize - bounty hunter fee)

# Details
- the bounty is only valid if DAO did not win yet. The win is defined as DAO owning
all remaining bunkers. The bounty is valid if there are some bunkers not
owned by DAO [Link](./contracts/DoomsdayBounty.sol#L59)
- the bounty is only valid if the bounty hunter managed to end
the game [Link](./contracts/DoomsdayBounty.sol#L66) 
- the bounty is only valid if at the end of the game the bounty contract owns
a winning bunker so it can claim a prize on behalf of 
DAO [Link](./contracts/DoomsdayBounty.sol#L67)
- the bounty is only valid if the prize has a reasonable 
size [Link](./contracts/DoomsdayBounty.sol#L70)
- the bounty is only valid if the bounty contract was able to receive the prize
from the Doomsday contract [Link](./contracts/DoomsdayBounty.sol#L75)
- the bounty is only valid if the bounty hunter received 
the bounty [Link](./contracts/DoomsdayBounty.sol#L79)
- the bounty is only valid if DAO received the rest of winning prize after
paying the bounty hunter fee [Link](./contracts/DoomsdayBounty.sol#L81)

# DAO rights
- DAO has an exclusive right to set a bounty fee percentage between
0% and 10% at any time [Link](./contracts/DoomsdayBounty.sol#L47)
- DAO has an exclusive right to withdraw any ETH from this contract
at any time [Link](./contracts/DoomsdayBounty.sol#L104)
- DAO has an exclusive right to perform any operations on behalf of
the bounty contract at any time. For example if for some reason somebody
sends a NFT or WETH to this contract, DAO has an exclusive right to
transfer assets anywhere they wish [Link](./contracts/DoomsdayBounty.sol#L109)


# Rights granted to anybody including DAO
- everybody has a right to transfer a bunker out of this contract to the DAO. 
If the bounty is successful the contract will own a winning bunker. Anybody
including DAO can transfer this bunker back to 
DAO [Link](./contracts/DoomsdayBounty.sol#L98)

# Right granted to a bounty hunter (*only* during hunt)
- bounty hunter has a right to evacuate any 
DAO bunker [Link](./contracts/DoomsdayBounty.sol#L88)
- bounty hunter has a right to transfer any DAO bunker
to the bounty contract [Link](./contracts/DoomsdayBounty.sol#L94)
 

# Operation of contract
- should DAO wish to enable the bounty they should 
call `setApprovalForAll` on Doomsday NFT contract and add a bounty 
contract as an operator
- should DAO wish to disable the bounty they should
call `setApprovalForAll` on Doomsday NFT contract and remove a bounty
contract as an operator. Note that if DAO manages to come to an agreement
with other participants offchain and wish to stop the bounty they should 
proactively call `setApprovalForAll` and disable the bounty
- should DAO wish to change the bounty fee they should
call `setBountyFee` 
- at the end of the game DAO should call `transferToDAO` if they wish
to have a winning bunker back. Though anybody could call it there is no
incentive to call this method and therefore the winning bunker will be
owned by a bounty contract until DAO claims it back.

# Disclaimer
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF 
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT
OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

# How to test during development
- Create .env file using .env.example as an example.
- Replace `<YOUR ALCHEMY KEY>` with your alchemy key
- Compile contracts `npx hardhat compile`
- Run tests `npx hardhat test`
