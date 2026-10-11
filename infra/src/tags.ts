// Tags are labels stuck on AWS resources. They help you find things, split the bill by project,
// and see which tool created a resource.

// 1. These three tags go on EVERY resource we create.
export const commonTags = {
  Project: "minitickets",
  Env: "dev",
  ManagedBy: "pulumi",
};

// 2. Every resource gets the common tags plus a Name tag. The AWS console shows the "Name" tag
//    as the resource's title, so without it you would only see ids like "vpc-0a1b2c...".
export function tagsFor(name: string) {
  return { ...commonTags, Name: name };
}
