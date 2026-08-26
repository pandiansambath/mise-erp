class Solution:
    def containsDuplicate(self, nums: List[int]) -> bool:
        same_value=0
        for i in range(len(nums)):
            if nums[i]==same_value:
                return True
            same_value = nums[i]
        else:
            return False

print(Solution().containsDuplicate([1,2,3,1]))