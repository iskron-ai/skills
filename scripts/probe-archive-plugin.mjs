// Public plugin API observation only: no prompt, model, removal or client lifecycle action.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
export default {
  id: 'archive-surface4540',
  async setup(ctx) {
    await ctx.session.hook('prompt',async ({sessionID})=>{
      const before=await ctx.session.get({sessionID});
      const result=await ctx.session.update({sessionID,archived:true});
      const after=await ctx.session.get({sessionID});
      writeFileSync(join(process.env.HOME,'archive-surface.json'),JSON.stringify({version:ctx.app.version,id:sessionID,before,result,after},null,2),{mode:0o600});
      throw new Error('LOCAL archive surface observation: deliberately no model');
    });
  },
};
